import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as OtlpSerialization from "effect/unstable/observability/OtlpSerialization";
import * as OtlpTracer from "effect/unstable/observability/OtlpTracer";

import { RelayApi } from "@t3tools/contracts/relay";

import {
  RelayHttpPlatformLayer,
  clientApi,
  dpopClientApi,
  healthApi,
  metadataApi,
  mobileApi,
  relayClientAuthLayer,
  relayDpopClientAuthLayer,
  relayCors,
  relayEnvironmentAuthLayer,
  serverApi,
  traceRelayHttpRequest,
  tokenApi,
} from "./api.ts";
import {
  MANAGED_ENDPOINT_ZONE,
  managedEndpointBaseDomain,
  managedEndpointProvisionerTokenPolicies,
  relayPublicOrigin,
} from "./infra/ManagedEndpointStackConfig.ts";
import { ImportedCloudflareZone } from "./infra/ImportedCloudflareZone.ts";
import {
  RELAY_OBSERVABILITY_EXPORT_INTERVAL,
  RELAY_OBSERVABILITY_SERVICE_NAME,
  provisionRelayObservability,
} from "./infra/RelayObservability.ts";
import * as DeliveryAttempts from "./persistence/DeliveryAttempts.ts";
import * as AgentActivityRows from "./persistence/AgentActivityRows.ts";
import * as Devices from "./persistence/Devices.ts";
import * as DpopProofs from "./persistence/DpopProofs.ts";
import * as EnvironmentCredentials from "./persistence/EnvironmentCredentials.ts";
import * as EnvironmentLinks from "./persistence/EnvironmentLinks.ts";
import * as LiveActivities from "./persistence/LiveActivities.ts";
import { RelayDb, RelayHyperdrive } from "./db.ts";
import { RelayApnsDeliveryDeadLetterQueue, RelayApnsDeliveryQueue } from "./queues.ts";
import * as Settings from "./settings.ts";
import * as AgentActivityPublisher from "./services/AgentActivityPublisher.ts";
import * as ApnsDeliveryQueue from "./services/ApnsDeliveryQueue.ts";
import * as ApnsDeliveries from "./services/ApnsDeliveries.ts";
import * as EnvironmentConnector from "./services/EnvironmentConnector.ts";
import * as EnvironmentLinker from "./services/EnvironmentLinker.ts";
import * as EnvironmentPublishSignatures from "./services/EnvironmentPublishSignatures.ts";
import * as ManagedEndpointProvider from "./services/ManagedEndpointProvider.ts";
import * as MobileRegistrations from "./services/MobileRegistrations.ts";
import * as RelayCrypto from "./RelayCrypto.ts";

const relayApiLayer = Layer.mergeAll(
  healthApi,
  metadataApi,
  mobileApi,
  clientApi,
  tokenApi,
  dpopClientApi,
  serverApi,
);

const makeAxiomHeaders = (input: {
  readonly token: Redacted.Redacted<string>;
  readonly dataset: string;
}) => ({
  Authorization: `Bearer ${Redacted.value(input.token)}`,
  "X-Axiom-Dataset": input.dataset,
});

const makeRelayTraceLayer = (input: {
  readonly tracesEndpoint: string;
  readonly eventsDatasetName: string;
  readonly ingestToken: Redacted.Redacted<string>;
}) =>
  OtlpTracer.layer({
    url: input.tracesEndpoint,
    resource: {
      serviceName: RELAY_OBSERVABILITY_SERVICE_NAME,
      attributes: {
        "service.runtime": "cloudflare-worker",
        "service.component": "relay",
      },
    },
    headers: makeAxiomHeaders({
      token: input.ingestToken,
      dataset: input.eventsDatasetName,
    }),
    exportInterval: RELAY_OBSERVABILITY_EXPORT_INTERVAL,
  }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));

export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  {
    main: import.meta.filename,
    compatibility: {
      date: "2026-05-22",
      flags: ["nodejs_compat"],
    },
  },
  Effect.gen(function* () {
    const managedEndpointZone = yield* ImportedCloudflareZone("ManagedEndpointZone", {
      zoneId: MANAGED_ENDPOINT_ZONE.zoneId,
      baseSubdomain: MANAGED_ENDPOINT_ZONE.baseSubdomain,
    });
    const managedEndpointProvisionerToken = yield* Cloudflare.AccountApiToken(
      "ManagedEndpointProvisionerToken",
      {
        name: "t3-code-relay-managed-endpoint-provisioner",
        policies: Output.all(managedEndpointZone.accountId, managedEndpointZone.zoneId).pipe(
          Output.map(([accountId, zoneId]) =>
            managedEndpointProvisionerTokenPolicies({ accountId, zoneId }),
          ),
        ),
      },
    );
    const relayIssuer = yield* Output.map(managedEndpointZone.name, (name) =>
      relayPublicOrigin({ name }),
    );
    const managedEndpointBaseDomainValue = yield* Output.map(managedEndpointZone.name, (name) =>
      managedEndpointBaseDomain({
        name,
        baseSubdomain: MANAGED_ENDPOINT_ZONE.baseSubdomain,
      }),
    );
    const managedEndpointCloudflareAccountId = yield* managedEndpointZone.accountId;
    const managedEndpointCloudflareZoneId = yield* managedEndpointZone.zoneId;
    const managedEndpointCloudflareApiToken = yield* managedEndpointProvisionerToken.value;
    const relayHyperdrive = yield* RelayHyperdrive;
    const apnsDeliveryQueue = yield* RelayApnsDeliveryQueue;
    const apnsDeliveryDeadLetterQueue = yield* RelayApnsDeliveryDeadLetterQueue;
    const hyperdrive = yield* Cloudflare.Hyperdrive.bind(relayHyperdrive);
    const apnsDeliveryQueueSender = yield* Cloudflare.QueueBinding.bind(apnsDeliveryQueue);
    const cloudMintKeyPair = yield* Alchemy.KeyPair("CloudMintKeyPair");
    const environment = yield* Config.schema(Settings.ApnsEnvironment, "APNS_ENVIRONMENT").pipe(
      Config.withDefault("sandbox"),
    );
    const apnsTeamId = yield* Config.string("APNS_TEAM_ID");
    const apnsKeyId = yield* Config.string("APNS_KEY_ID");
    const apnsBundleId = yield* Config.string("APNS_BUNDLE_ID");
    const apnsPrivateKey = yield* Config.redacted("APNS_PRIVATE_KEY");
    const relayObservability = yield* provisionRelayObservability;
    const axiomIngestToken = yield* relayObservability.ingestToken.token;
    const axiomTracesEndpoint = yield* relayObservability.events.otelTracesEndpoint;
    const axiomEventsDatasetName = yield* relayObservability.events.name;
    const relayTraceLayer = Effect.all({
      tracesEndpoint: axiomTracesEndpoint,
      eventsDatasetName: axiomEventsDatasetName,
      ingestToken: axiomIngestToken,
    }).pipe(Effect.map(makeRelayTraceLayer), Layer.unwrap);
    const randomApnsDeliveryJobSigningSecret = yield* Alchemy.Random(
      "ApnsDeliveryJobSigningSecret",
      { bytes: 32 },
    );
    const apnsDeliveryJobSigningSecret = yield* randomApnsDeliveryJobSigningSecret.text;
    const clerkSecretKey = yield* Config.redacted("CLERK_SECRET_KEY");
    const cloudMintPrivateKey = yield* cloudMintKeyPair.privateKey;
    const cloudMintPublicKey = yield* cloudMintKeyPair.publicKey;
    const db = yield* Drizzle.postgres(hyperdrive.connectionString);

    const getSettings = yield* Effect.cached(
      Effect.gen(function* () {
        return Settings.Settings.of({
          relayIssuer: yield* relayIssuer,
          apns: {
            environment,
            teamId: apnsTeamId,
            keyId: apnsKeyId,
            bundleId: apnsBundleId,
            privateKey: apnsPrivateKey,
          },
          apnsDeliveryJobSigningSecret: yield* apnsDeliveryJobSigningSecret,
          clerkSecretKey,
          cloudMintPrivateKey: yield* cloudMintPrivateKey,
          cloudMintPublicKey: yield* cloudMintPublicKey,
          managedEndpointBaseDomain: yield* managedEndpointBaseDomainValue,
          cloudflareAccountId: yield* managedEndpointCloudflareAccountId,
          cloudflareZoneId: yield* managedEndpointCloudflareZoneId,
          cloudflareApiToken: yield* managedEndpointCloudflareApiToken,
        });
      }),
    );

    const makeRuntimeLayer = (settings: Settings.SettingsShape) =>
      Layer.mergeAll(
        MobileRegistrations.layer.pipe(Layer.provideMerge(AgentActivityPublisher.layer)),
        EnvironmentConnector.layer,
        EnvironmentLinker.layer.pipe(
          Layer.provideMerge(ManagedEndpointProvider.layer),
          Layer.provideMerge(DpopProofs.layer),
        ),
        EnvironmentPublishSignatures.layer.pipe(Layer.provideMerge(DpopProofs.layer)),
        DpopProofs.layer,
      ).pipe(
        Layer.provide(ApnsDeliveries.layer),
        Layer.provide(ApnsDeliveryQueue.layer),
        Layer.provide(AgentActivityRows.layer),
        Layer.provide(Devices.layer),
        Layer.provide(EnvironmentCredentials.layer),
        Layer.provide(EnvironmentLinks.layer),
        Layer.provide(LiveActivities.layer),
        Layer.provide(DeliveryAttempts.layer),
        Layer.provide(Layer.succeed(RelayDb, db)),
        Layer.provide(
          Layer.succeed(ApnsDeliveryQueue.ApnsDeliveryQueueSender, {
            send: (body) =>
              apnsDeliveryQueueSender
                .send(body)
                .pipe(
                  Effect.mapError(
                    (cause) => new ApnsDeliveryQueue.ApnsDeliveryQueueSendError({ cause }),
                  ),
                ) as Effect.Effect<void, ApnsDeliveryQueue.ApnsDeliveryQueueSendError>,
          }),
        ),
        Layer.provide(Layer.succeed(Settings.Settings, settings)),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(RelayCrypto.layer),
      );

    const makeAppLayer = (settings: Settings.SettingsShape) => {
      const runtimeLayer = makeRuntimeLayer(settings);
      return relayApiLayer.pipe(
        Layer.provide(runtimeLayer),
        Layer.provide(relayClientAuthLayer),
        Layer.provide(relayDpopClientAuthLayer),
        Layer.provide(relayEnvironmentAuthLayer),
        Layer.provide(EnvironmentCredentials.layer),
        Layer.provide(EnvironmentLinks.layer),
        Layer.provide(Layer.succeed(RelayDb, db)),
        Layer.provide(Layer.succeed(Settings.Settings, settings)),
        Layer.provide(RelayCrypto.layer),
      );
    };

    yield* Cloudflare.messages<unknown>(apnsDeliveryQueue, {
      batchSize: 10,
      maxRetries: 5,
      maxWaitTime: "5 seconds",
      retryDelay: 30,
      deadLetterQueue: apnsDeliveryDeadLetterQueue.queueName as unknown as string,
    }).subscribe((stream) =>
      Stream.runForEach(stream, (message) =>
        Effect.gen(function* () {
          const settings = yield* getSettings;
          yield* Effect.gen(function* () {
            const deliveries = yield* ApnsDeliveries.ApnsDeliveries;
            return yield* deliveries.processSignedJob(message.body);
          }).pipe(Effect.provide(makeRuntimeLayer(settings)));
        }),
      ),
    );

    yield* Cloudflare.cron("*/5 * * * *").subscribe(
      Effect.fnUntraced(function* () {
        yield* DpopProofs.pruneExpired(db);
      }),
    );

    const buildFetch = Effect.fnUntraced(function* () {
      const settings = yield* getSettings;
      const handler = yield* HttpApiBuilder.layer(RelayApi).pipe(
        Layer.provide(makeAppLayer(settings)),
        Layer.provide([Etag.layerWeak, RelayHttpPlatformLayer, relayCors]),
        HttpRouter.toHttpEffect,
      );
      const tracer = yield* Effect.tracer;
      return { handler: traceRelayHttpRequest(handler, tracer) };
    });
    const getFetch = yield* Effect.cached(buildFetch().pipe(Effect.provide(relayTraceLayer)));
    const fetch = getFetch.pipe(Effect.map(({ handler }) => handler));

    return { fetch };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.HyperdriveBindingLive,
        Cloudflare.CronEventSourceLive,
        Cloudflare.QueueBindingLive,
        Cloudflare.QueueEventSourceLive,
      ),
    ),
  ),
) {}
