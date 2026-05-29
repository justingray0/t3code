import {
  AuthAccessManageScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayManageScope,
  AuthReviewWriteScope,
  AuthTerminalOperateScope,
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpForbiddenError,
  EnvironmentHttpInternalServerError,
  EnvironmentAccessManagementAuth,
  EnvironmentAccessManagementPrincipal,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentOrchestrationOperationAuth,
  EnvironmentOrchestrationOperationPrincipal,
  EnvironmentOrchestrationReadAuth,
  EnvironmentOrchestrationReadPrincipal,
  EnvironmentRelayManagementAuth,
  EnvironmentRelayManagementPrincipal,
  EnvironmentHttpUnauthorizedError,
} from "@t3tools/contracts";
import type {
  AuthBrowserSessionRequest,
  AuthCreatePairingCredentialInput,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  AuthTokenExchangeRequest,
  AuthEnvironmentScope,
} from "@t3tools/contracts";
import { parseAllowedOAuthScope } from "@t3tools/shared/oauthScope";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Cookies from "effect/unstable/http/Cookies";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { AuthError, ServerAuth } from "./Services/ServerAuth.ts";
import { SessionCredentialService } from "./Services/SessionCredentialService.ts";
import { deriveAuthClientMetadata } from "./utils.ts";

export const respondToAuthError = (error: AuthError) =>
  Effect.gen(function* () {
    if ((error.status ?? 500) >= 500) {
      yield* Effect.logError("auth route failed", {
        message: error.message,
        cause: error.cause,
      });
    }
    return HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
      },
      { status: error.status ?? 500 },
    );
  });

export const failEnvironmentHttpAuthError = (error: AuthError) =>
  Effect.gen(function* () {
    if ((error.status ?? 500) >= 500) {
      yield* Effect.logError("auth route failed", {
        message: error.message,
        cause: error.cause,
      });
    }

    switch (error.status) {
      case 400:
        return yield* new EnvironmentHttpBadRequestError({ message: error.message });
      case 401:
        return yield* new EnvironmentHttpUnauthorizedError({ message: error.message });
      case 403:
        return yield* new EnvironmentHttpForbiddenError({ message: error.message });
      default:
        return yield* new EnvironmentHttpInternalServerError({ message: error.message });
    }
  });

export const environmentAuthenticatedAuthLayer = Layer.effect(
  EnvironmentAuthenticatedAuth,
  Effect.gen(function* () {
    const serverAuth = yield* ServerAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* serverAuth.authenticateHttpRequest(request);
        return yield* httpEffect.pipe(
          Effect.provideService(EnvironmentAuthenticatedPrincipal, session),
        );
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError));
  }),
);

export const environmentOrchestrationReadAuthLayer = Layer.effect(
  EnvironmentOrchestrationReadAuth,
  Effect.gen(function* () {
    const serverAuth = yield* ServerAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* serverAuth.authenticateHttpRequest(request);
        if (!session.scopes.includes(AuthOrchestrationReadScope)) {
          return yield* new AuthError({
            message: "The authenticated token is missing required scope: orchestration:read.",
            status: 403,
          });
        }
        return yield* httpEffect.pipe(
          Effect.provideService(EnvironmentOrchestrationReadPrincipal, session),
        );
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError));
  }),
);

export const environmentOrchestrationOperationAuthLayer = Layer.effect(
  EnvironmentOrchestrationOperationAuth,
  Effect.gen(function* () {
    const serverAuth = yield* ServerAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* serverAuth.authenticateHttpRequest(request);
        if (!session.scopes.includes(AuthOrchestrationOperateScope)) {
          return yield* new AuthError({
            message: "The authenticated token is missing required scope: orchestration:operate.",
            status: 403,
          });
        }
        return yield* httpEffect.pipe(
          Effect.provideService(EnvironmentOrchestrationOperationPrincipal, session),
        );
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError));
  }),
);

export const environmentAccessManagementAuthLayer = Layer.effect(
  EnvironmentAccessManagementAuth,
  Effect.gen(function* () {
    const serverAuth = yield* ServerAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* serverAuth.authenticateHttpRequest(request);
        if (!session.scopes.includes(AuthAccessManageScope)) {
          return yield* new AuthError({
            message: "The authenticated token is missing required scope: access:manage.",
            status: 403,
          });
        }
        return yield* httpEffect.pipe(
          Effect.provideService(EnvironmentAccessManagementPrincipal, session),
        );
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError));
  }),
);

export const environmentRelayManagementAuthLayer = Layer.effect(
  EnvironmentRelayManagementAuth,
  Effect.gen(function* () {
    const serverAuth = yield* ServerAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* serverAuth.authenticateHttpRequest(request);
        if (!session.scopes.includes(AuthRelayManageScope)) {
          return yield* new AuthError({
            message: "The authenticated token is missing required scope: relay:manage.",
            status: 403,
          });
        }
        return yield* httpEffect.pipe(
          Effect.provideService(EnvironmentRelayManagementPrincipal, session),
        );
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError));
  }),
);

export const authHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "auth",
  Effect.fnUntraced(function* (handlers) {
    const serverAuth = yield* ServerAuth;
    const sessions = yield* SessionCredentialService;

    const sessionHandler = Effect.fn("environment.auth.session")(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* serverAuth.getSessionState(request);
    });

    const browserSessionHandler = Effect.fn("environment.auth.browserSession")(
      function* (input: { readonly payload: AuthBrowserSessionRequest }) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const result = yield* serverAuth.createBrowserSession(
          input.payload.credential,
          deriveAuthClientMetadata({ request }),
        );
        const sessionCookies = yield* Effect.fromResult(
          Cookies.set(Cookies.empty, sessions.cookieName, result.sessionToken, {
            expires: DateTime.toDate(result.response.expiresAt),
            httpOnly: true,
            path: "/",
            sameSite: "lax",
          }),
        ).pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({
                message: "Failed to create browser session response.",
                status: 500,
                cause,
              }),
          ),
        );

        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.mergeCookies(response, sessionCookies)),
        );
        return result.response;
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    const tokenHandler = Effect.fn("environment.auth.token")(
      function* (input: { readonly payload: AuthTokenExchangeRequest }) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestedScopes = parseAllowedOAuthScope({
          value: input.payload.scope,
          allowedScopes: new Set<AuthEnvironmentScope>([
            AuthOrchestrationReadScope,
            AuthOrchestrationOperateScope,
            AuthTerminalOperateScope,
            AuthReviewWriteScope,
            AuthAccessManageScope,
            AuthRelayManageScope,
          ]),
        });
        if (requestedScopes === null) {
          return yield* new AuthError({
            message: "Requested token scope is invalid.",
            status: 400,
          });
        }
        return yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
          input.payload.subject_token,
          requestedScopes,
          deriveAuthClientMetadata({ request }),
        );
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    const webSocketTicketHandler = Effect.fn("environment.auth.webSocketTicket")(
      function* () {
        const session = yield* EnvironmentAuthenticatedPrincipal;
        return yield* serverAuth.issueWebSocketTicket(session);
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    const pairingCredentialHandler = Effect.fn("environment.auth.pairingCredential")(
      function* (input: { readonly payload: AuthCreatePairingCredentialInput }) {
        return yield* serverAuth.issuePairingCredential(input.payload);
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    const pairingLinksHandler = Effect.fn("environment.auth.pairingLinks")(
      function* () {
        return yield* serverAuth.listPairingLinks();
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    const revokePairingLinkHandler = Effect.fn("environment.auth.revokePairingLink")(
      function* (input: { readonly payload: AuthRevokePairingLinkInput }) {
        const revoked = yield* serverAuth.revokePairingLink(input.payload.id);
        return { revoked };
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    const clientsHandler = Effect.fn("environment.auth.clients")(
      function* () {
        const session = yield* EnvironmentAccessManagementPrincipal;
        return yield* serverAuth.listClientSessions(session.sessionId);
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    const revokeClientHandler = Effect.fn("environment.auth.revokeClient")(
      function* (input: { readonly payload: AuthRevokeClientSessionInput }) {
        const session = yield* EnvironmentAccessManagementPrincipal;
        const revoked = yield* serverAuth.revokeClientSession(
          session.sessionId,
          input.payload.sessionId,
        );
        return { revoked };
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    const revokeOtherClientsHandler = Effect.fn("environment.auth.revokeOtherClients")(
      function* () {
        const session = yield* EnvironmentAccessManagementPrincipal;
        const revokedCount = yield* serverAuth.revokeOtherClientSessions(session.sessionId);
        return { revokedCount };
      },
      Effect.catchTag("AuthError", failEnvironmentHttpAuthError),
    );

    return handlers
      .handle("session", sessionHandler)
      .handle("browserSession", browserSessionHandler)
      .handle("token", tokenHandler)
      .handle("webSocketTicket", webSocketTicketHandler)
      .handle("pairingCredential", pairingCredentialHandler)
      .handle("pairingLinks", pairingLinksHandler)
      .handle("revokePairingLink", revokePairingLinkHandler)
      .handle("clients", clientsHandler)
      .handle("revokeClient", revokeClientHandler)
      .handle("revokeOtherClients", revokeOtherClientsHandler);
  }),
);
