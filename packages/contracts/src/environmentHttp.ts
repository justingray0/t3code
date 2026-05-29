import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import {
  AuthAccessTokenResult,
  AuthBrowserSessionRequest,
  AuthBrowserSessionResult,
  AuthClientSession,
  AuthCreatePairingCredentialInput,
  AuthPairingCredentialResult,
  AuthPairingLink,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  AuthEnvironmentScopes,
  AuthTokenExchangeRequest,
  AuthSessionState,
  AuthWebSocketTicketResult,
  ServerAuthSessionMethod,
} from "./auth.ts";
import { AuthSessionId } from "./baseSchemas.ts";
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

export const EnvironmentHttpCommonError = Schema.Union([
  EnvironmentHttpBadRequestError,
  EnvironmentHttpUnauthorizedError,
  EnvironmentHttpForbiddenError,
  EnvironmentHttpInternalServerError,
]);
export type EnvironmentHttpCommonError = typeof EnvironmentHttpCommonError.Type;

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

export interface EnvironmentSessionPrincipalShape {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly scopes: AuthEnvironmentScopes;
  readonly expiresAt?: DateTime.DateTime;
}

export class EnvironmentAuthenticatedPrincipal extends Context.Service<
  EnvironmentAuthenticatedPrincipal,
  EnvironmentSessionPrincipalShape
>()("@t3tools/contracts/environmentHttp/EnvironmentAuthenticatedPrincipal") {}

export class EnvironmentOrchestrationReadPrincipal extends Context.Service<
  EnvironmentOrchestrationReadPrincipal,
  EnvironmentSessionPrincipalShape
>()("@t3tools/contracts/environmentHttp/EnvironmentOrchestrationReadPrincipal") {}

export class EnvironmentOrchestrationOperationPrincipal extends Context.Service<
  EnvironmentOrchestrationOperationPrincipal,
  EnvironmentSessionPrincipalShape
>()("@t3tools/contracts/environmentHttp/EnvironmentOrchestrationOperationPrincipal") {}

export class EnvironmentAccessManagementPrincipal extends Context.Service<
  EnvironmentAccessManagementPrincipal,
  EnvironmentSessionPrincipalShape
>()("@t3tools/contracts/environmentHttp/EnvironmentAccessManagementPrincipal") {}

export class EnvironmentRelayManagementPrincipal extends Context.Service<
  EnvironmentRelayManagementPrincipal,
  EnvironmentSessionPrincipalShape
>()("@t3tools/contracts/environmentHttp/EnvironmentRelayManagementPrincipal") {}

export class EnvironmentAuthenticatedAuth extends HttpApiMiddleware.Service<
  EnvironmentAuthenticatedAuth,
  { provides: EnvironmentAuthenticatedPrincipal }
>()("EnvironmentAuthenticatedAuth", {
  error: EnvironmentHttpAuthErrors,
}) {}

export class EnvironmentOrchestrationReadAuth extends HttpApiMiddleware.Service<
  EnvironmentOrchestrationReadAuth,
  { provides: EnvironmentOrchestrationReadPrincipal }
>()("EnvironmentOrchestrationReadAuth", {
  error: EnvironmentHttpAuthErrors,
}) {}

export class EnvironmentOrchestrationOperationAuth extends HttpApiMiddleware.Service<
  EnvironmentOrchestrationOperationAuth,
  { provides: EnvironmentOrchestrationOperationPrincipal }
>()("EnvironmentOrchestrationOperationAuth", {
  error: EnvironmentHttpAuthErrors,
}) {}

export class EnvironmentAccessManagementAuth extends HttpApiMiddleware.Service<
  EnvironmentAccessManagementAuth,
  { provides: EnvironmentAccessManagementPrincipal }
>()("EnvironmentAccessManagementAuth", {
  error: EnvironmentHttpAuthErrors,
}) {}

export class EnvironmentRelayManagementAuth extends HttpApiMiddleware.Service<
  EnvironmentRelayManagementAuth,
  { provides: EnvironmentRelayManagementPrincipal }
>()("EnvironmentRelayManagementAuth", {
  error: EnvironmentHttpAuthErrors,
}) {}

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
    HttpApiEndpoint.post("browserSession", "/api/auth/browser-session", {
      payload: AuthBrowserSessionRequest,
      success: AuthBrowserSessionResult,
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("token", "/oauth/token", {
      payload: AuthTokenExchangeRequest,
      success: AuthAccessTokenResult,
      error: EnvironmentHttpAuthErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("webSocketTicket", "/api/auth/websocket-ticket", {
      headers: OptionalBearerHeaders,
      success: AuthWebSocketTicketResult,
      error: EnvironmentHttpAuthErrors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("pairingCredential", "/api/auth/pairing-token", {
      headers: OptionalBearerHeaders,
      payload: AuthCreatePairingCredentialInput,
      success: AuthPairingCredentialResult,
      error: EnvironmentHttpAuthErrors,
    }).middleware(EnvironmentAccessManagementAuth),
  )
  .add(
    HttpApiEndpoint.get("pairingLinks", "/api/auth/pairing-links", {
      headers: OptionalBearerHeaders,
      success: Schema.Array(AuthPairingLink),
      error: EnvironmentHttpAuthErrors,
    }).middleware(EnvironmentAccessManagementAuth),
  )
  .add(
    HttpApiEndpoint.post("revokePairingLink", "/api/auth/pairing-links/revoke", {
      headers: OptionalBearerHeaders,
      payload: AuthRevokePairingLinkInput,
      success: AuthPairingLinkRevokeResult,
      error: EnvironmentHttpAuthErrors,
    }).middleware(EnvironmentAccessManagementAuth),
  )
  .add(
    HttpApiEndpoint.get("clients", "/api/auth/clients", {
      headers: OptionalBearerHeaders,
      success: Schema.Array(AuthClientSession),
      error: EnvironmentHttpAuthErrors,
    }).middleware(EnvironmentAccessManagementAuth),
  )
  .add(
    HttpApiEndpoint.post("revokeClient", "/api/auth/clients/revoke", {
      headers: OptionalBearerHeaders,
      payload: AuthRevokeClientSessionInput,
      success: AuthClientSessionRevokeResult,
      error: EnvironmentHttpAuthErrors,
    }).middleware(EnvironmentAccessManagementAuth),
  )
  .add(
    HttpApiEndpoint.post("revokeOtherClients", "/api/auth/clients/revoke-others", {
      headers: OptionalBearerHeaders,
      success: AuthOtherClientSessionsRevokeResult,
      error: EnvironmentHttpAuthErrors,
    }).middleware(EnvironmentAccessManagementAuth),
  ) {}

export class EnvironmentOrchestrationHttpApi extends HttpApiGroup.make("orchestration")
  .add(
    HttpApiEndpoint.get("snapshot", "/api/orchestration/snapshot", {
      headers: OptionalBearerHeaders,
      success: OrchestrationReadModel,
      error: EnvironmentHttpOrchestrationErrors,
    }).middleware(EnvironmentOrchestrationReadAuth),
  )
  .add(
    HttpApiEndpoint.post("dispatch", "/api/orchestration/dispatch", {
      headers: OptionalBearerHeaders,
      payload: ClientOrchestrationCommand,
      success: DispatchResult,
      error: EnvironmentHttpOrchestrationErrors,
    }).middleware(EnvironmentOrchestrationOperationAuth),
  ) {}

export class EnvironmentHttpApi extends HttpApi.make("environment")
  .add(EnvironmentMetadataHttpApi)
  .add(EnvironmentAuthHttpApi)
  .add(EnvironmentOrchestrationHttpApi) {}
