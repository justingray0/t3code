import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { describe, it, assert } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as ProviderSessionRuntime from "../../persistence/ProviderSessionRuntime.ts";
import { ProviderSessionDirectoryLive } from "./ProviderSessionDirectory.ts";
import { recoverOrphanedProviderSessions } from "./ProviderSessionRecovery.ts";

const threadId = ThreadId.make("thread-recovery-1");
const grokInstanceId = ProviderInstanceId.make("grok");
const resumeCursor = { schemaVersion: 1, sessionId: "session-recovery-1" };

const makeTestLayer = (dispatchedRef: Ref.Ref<Array<OrchestrationCommand>>) => {
  const runtimeRepositoryLayer = ProviderSessionRuntime.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
  );
  const directoryLayer = ProviderSessionDirectoryLive.pipe(Layer.provide(runtimeRepositoryLayer));
  const engineLayer = Layer.succeed(OrchestrationEngineService, {
    dispatch: (command) =>
      Ref.update(dispatchedRef, (current) => [...current, command]).pipe(
        Effect.as({ sequence: 1 }),
      ),
    readEvents: () => {
      throw new Error("not implemented in test");
    },
    streamDomainEvents: Effect.die("not implemented in test") as never,
  });
  const cryptoLayer = Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => new Uint8Array(size),
      digest: () => Effect.succeed(new Uint8Array(32)),
    }),
  );

  return Layer.mergeAll(directoryLayer, runtimeRepositoryLayer, engineLayer, cryptoLayer);
};

describe("ProviderSessionRecovery", () => {
  it.effect("settles orphaned runtime bindings and marks them stopped on startup", () =>
    Effect.gen(function* () {
      const dispatchedRef = yield* Ref.make<Array<OrchestrationCommand>>([]);
      const testLayer = makeTestLayer(dispatchedRef);

      const dispatched = yield* Effect.gen(function* () {
        const repository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
        yield* repository.upsert({
          threadId,
          providerName: ProviderDriverKind.make("grok"),
          providerInstanceId: grokInstanceId,
          adapterKey: "grok",
          runtimeMode: "full-access",
          status: "running",
          lastSeenAt: "2026-06-29T17:54:19.390Z",
          resumeCursor,
          runtimePayload: {
            activeTurnId: "turn-orphaned",
            lastRuntimeEvent: "provider.sendTurn",
          },
        });

        yield* recoverOrphanedProviderSessions;

        const persisted = yield* repository.getByThreadId({ threadId });
        assert.equal(Option.isSome(persisted), true);
        if (Option.isSome(persisted)) {
          assert.equal(persisted.value.status, "stopped");
          assert.deepEqual(persisted.value.resumeCursor, resumeCursor);
          const payload = persisted.value.runtimePayload;
          assert.equal(
            payload !== null && typeof payload === "object" && !Array.isArray(payload),
            true,
          );
          if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
            assert.equal((payload as { activeTurnId: string | null }).activeTurnId, null);
            assert.equal(
              (payload as { lastRuntimeEvent: string }).lastRuntimeEvent,
              "provider.session.recovered",
            );
          }
        }

        return yield* Ref.get(dispatchedRef);
      }).pipe(Effect.provide(testLayer));

      assert.equal(dispatched.length, 1);
      assert.equal(dispatched[0]?.type, "thread.session.set");
      if (dispatched[0]?.type === "thread.session.set") {
        assert.equal(dispatched[0].session.status, "ready");
        assert.equal(dispatched[0].session.activeTurnId, null);
        assert.equal(dispatched[0].session.providerName, "grok");
      }
    }),
  );

  it.effect("skips already-terminal runtime bindings", () =>
    Effect.gen(function* () {
      const dispatchedRef = yield* Ref.make<Array<OrchestrationCommand>>([]);
      const testLayer = makeTestLayer(dispatchedRef);

      const dispatched = yield* Effect.gen(function* () {
        const repository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
        yield* repository.upsert({
          threadId,
          providerName: ProviderDriverKind.make("cursor"),
          providerInstanceId: ProviderInstanceId.make("cursor"),
          adapterKey: "cursor",
          runtimeMode: "full-access",
          status: "stopped",
          lastSeenAt: "2026-06-29T17:56:45.038Z",
          resumeCursor,
          runtimePayload: {
            activeTurnId: null,
          },
        });

        yield* recoverOrphanedProviderSessions;
        return yield* Ref.get(dispatchedRef);
      }).pipe(Effect.provide(testLayer));

      assert.equal(dispatched.length, 0);
    }),
  );
});
