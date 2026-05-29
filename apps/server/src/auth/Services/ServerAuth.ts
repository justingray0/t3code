import type {
  AuthAccessTokenResult,
  AuthBrowserSessionResult,
  AuthClientMetadata,
  AuthClientSession,
  AuthCreatePairingCredentialInput,
  AuthEnvironmentScope,
  AuthPairingLink,
  AuthPairingCredentialResult,
  AuthSessionId,
  AuthSessionState,
  ServerAuthDescriptor,
  ServerAuthSessionMethod,
  AuthWebSocketTicketResult,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

export interface AuthenticatedSession {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly expiresAt?: DateTime.DateTime;
}

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly status?: 400 | 401 | 403 | 500;
  readonly cause?: unknown;
}> {}

export interface ServerAuthShape {
  readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
  readonly getSessionState: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthSessionState, never>;
  readonly createBrowserSession: (
    credential: string,
    requestMetadata: AuthClientMetadata,
  ) => Effect.Effect<
    {
      readonly response: AuthBrowserSessionResult;
      readonly sessionToken: string;
    },
    AuthError
  >;
  readonly exchangeBootstrapCredentialForAccessToken: (
    credential: string,
    requestedScopes: ReadonlyArray<AuthEnvironmentScope>,
    requestMetadata: AuthClientMetadata,
  ) => Effect.Effect<AuthAccessTokenResult, AuthError>;
  readonly issuePairingCredential: (
    input?: AuthCreatePairingCredentialInput & {
      readonly scopes?: ReadonlyArray<AuthEnvironmentScope>;
    },
  ) => Effect.Effect<AuthPairingCredentialResult, AuthError>;
  readonly listPairingLinks: () => Effect.Effect<ReadonlyArray<AuthPairingLink>, AuthError>;
  readonly revokePairingLink: (id: string) => Effect.Effect<boolean, AuthError>;
  readonly listClientSessions: (
    currentSessionId: AuthSessionId,
  ) => Effect.Effect<ReadonlyArray<AuthClientSession>, AuthError>;
  readonly revokeClientSession: (
    currentSessionId: AuthSessionId,
    targetSessionId: AuthSessionId,
  ) => Effect.Effect<boolean, AuthError>;
  readonly revokeOtherClientSessions: (
    currentSessionId: AuthSessionId,
  ) => Effect.Effect<number, AuthError>;
  readonly authenticateHttpRequest: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedSession, AuthError>;
  readonly authenticateWebSocketUpgrade: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedSession, AuthError>;
  readonly issueWebSocketTicket: (
    session: AuthenticatedSession,
  ) => Effect.Effect<AuthWebSocketTicketResult, AuthError>;
  readonly issueStartupPairingUrl: (baseUrl: string) => Effect.Effect<string, AuthError>;
}

export class ServerAuth extends Context.Service<ServerAuth, ServerAuthShape>()(
  "t3/auth/Services/ServerAuth",
) {}
