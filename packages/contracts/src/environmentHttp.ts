import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import {
  AuthBearerBootstrapResult,
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthClientSession,
  AuthCreatePairingCredentialInput,
  AuthPairingCredentialResult,
  AuthPairingLink,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  AuthSessionState,
  AuthWebSocketTokenResult,
} from "./auth.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import {
  ClientOrchestrationCommand,
  DispatchResult,
  OrchestrationReadModel,
} from "./orchestration.ts";

const OptionalBearerHeaders = Schema.Struct({
  authorization: Schema.optionalKey(Schema.String),
});

export class EnvironmentHttpBadRequestError extends Schema.TaggedErrorClass<EnvironmentHttpBadRequestError>()(
  "EnvironmentHttpBadRequestError",
  {
    message: Schema.String,
  },
) {}

export class EnvironmentHttpUnauthorizedError extends Schema.TaggedErrorClass<EnvironmentHttpUnauthorizedError>()(
  "EnvironmentHttpUnauthorizedError",
  {
    message: Schema.String,
  },
) {}

export class EnvironmentHttpForbiddenError extends Schema.TaggedErrorClass<EnvironmentHttpForbiddenError>()(
  "EnvironmentHttpForbiddenError",
  {
    message: Schema.String,
  },
) {}

export class EnvironmentHttpInternalServerError extends Schema.TaggedErrorClass<EnvironmentHttpInternalServerError>()(
  "EnvironmentHttpInternalServerError",
  {
    message: Schema.String,
  },
) {}

const EnvironmentHttpBadRequestErrorResponse = EnvironmentHttpBadRequestError.pipe(
  HttpApiSchema.status("BadRequest"),
);
const EnvironmentHttpUnauthorizedErrorResponse = EnvironmentHttpUnauthorizedError.pipe(
  HttpApiSchema.status("Unauthorized"),
);
const EnvironmentHttpForbiddenErrorResponse = EnvironmentHttpForbiddenError.pipe(
  HttpApiSchema.status("Forbidden"),
);
const EnvironmentHttpInternalServerErrorResponse = EnvironmentHttpInternalServerError.pipe(
  HttpApiSchema.status("InternalServerError"),
);

const EnvironmentHttpAuthErrors = [
  EnvironmentHttpBadRequestErrorResponse,
  EnvironmentHttpUnauthorizedErrorResponse,
  EnvironmentHttpForbiddenErrorResponse,
  EnvironmentHttpInternalServerErrorResponse,
] as const;

const EnvironmentHttpOrchestrationErrors = [
  EnvironmentHttpBadRequestErrorResponse,
  EnvironmentHttpUnauthorizedErrorResponse,
  EnvironmentHttpForbiddenErrorResponse,
  EnvironmentHttpInternalServerErrorResponse,
] as const;

export const AuthPairingLinkRevokeResult = Schema.Struct({
  revoked: Schema.Boolean,
});
export type AuthPairingLinkRevokeResult = typeof AuthPairingLinkRevokeResult.Type;

export const AuthClientSessionRevokeResult = Schema.Struct({
  revoked: Schema.Boolean,
});
export type AuthClientSessionRevokeResult = typeof AuthClientSessionRevokeResult.Type;

export const AuthOtherClientSessionsRevokeResult = Schema.Struct({
  revokedCount: Schema.Number,
});
export type AuthOtherClientSessionsRevokeResult = typeof AuthOtherClientSessionsRevokeResult.Type;

export class EnvironmentMetadataHttpApi extends HttpApiGroup.make("metadata").add(
  HttpApiEndpoint.get("descriptor", "/.well-known/t3/environment", {
    success: ExecutionEnvironmentDescriptor,
  }),
) {}

export class EnvironmentAuthHttpApi extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("session", "/api/auth/session", {
      headers: OptionalBearerHeaders,
      success: AuthSessionState,
    }),
  )
  .add(
    HttpApiEndpoint.post("bootstrap", "/api/auth/bootstrap", {
      payload: AuthBootstrapInput,
      success: AuthBootstrapResult,
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("bootstrapBearer", "/api/auth/bootstrap/bearer", {
      payload: AuthBootstrapInput,
      success: AuthBearerBootstrapResult,
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("webSocketToken", "/api/auth/ws-token", {
      headers: OptionalBearerHeaders,
      success: AuthWebSocketTokenResult,
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("pairingCredential", "/api/auth/pairing-token", {
      payload: AuthCreatePairingCredentialInput,
      success: AuthPairingCredentialResult,
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("pairingLinks", "/api/auth/pairing-links", {
      success: Schema.Array(AuthPairingLink),
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("revokePairingLink", "/api/auth/pairing-links/revoke", {
      payload: AuthRevokePairingLinkInput,
      success: AuthPairingLinkRevokeResult,
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("clients", "/api/auth/clients", {
      success: Schema.Array(AuthClientSession),
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("revokeClient", "/api/auth/clients/revoke", {
      payload: AuthRevokeClientSessionInput,
      success: AuthClientSessionRevokeResult,
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("revokeOtherClients", "/api/auth/clients/revoke-others", {
      success: AuthOtherClientSessionsRevokeResult,
      error: EnvironmentHttpAuthErrors,
    }),
  ) {}

export class EnvironmentOrchestrationHttpApi extends HttpApiGroup.make("orchestration")
  .add(
    HttpApiEndpoint.get("snapshot", "/api/orchestration/snapshot", {
      headers: OptionalBearerHeaders,
      success: OrchestrationReadModel,
      error: EnvironmentHttpOrchestrationErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("dispatch", "/api/orchestration/dispatch", {
      headers: OptionalBearerHeaders,
      payload: ClientOrchestrationCommand,
      success: DispatchResult,
      error: EnvironmentHttpOrchestrationErrors,
    }),
  ) {}

export class EnvironmentHttpApi extends HttpApi.make("environment")
  .add(EnvironmentMetadataHttpApi)
  .add(EnvironmentAuthHttpApi)
  .add(EnvironmentOrchestrationHttpApi) {}
