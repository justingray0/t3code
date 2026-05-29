import {
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpForbiddenError,
  EnvironmentHttpInternalServerError,
  EnvironmentHttpUnauthorizedError,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
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

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new AuthError({
      message: "Only owner sessions can manage network access.",
      status: 403,
    });
  }
  return { serverAuth, session } as const;
});

export const authHttpApiLayer = HttpApiBuilder.group(EnvironmentHttpApi, "auth", (handlers) =>
  handlers
    .handle("session", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        return yield* serverAuth.getSessionState(request);
      }),
    )
    .handle("bootstrap", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const result = yield* serverAuth.exchangeBootstrapCredential(
          payload.credential,
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
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    )
    .handle("bootstrapBearer", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const result = yield* serverAuth.exchangeBootstrapCredentialForBearerSession(
          payload.credential,
          deriveAuthClientMetadata({ request }),
        );
        return result;
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    )
    .handle("webSocketToken", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const session = yield* serverAuth.authenticateHttpRequest(request);
        return yield* serverAuth.issueWebSocketToken(session);
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    )
    .handle("pairingCredential", ({ payload }) =>
      Effect.gen(function* () {
        const serverAuth = yield* ServerAuth;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* serverAuth.authenticateHttpRequest(request);
        if (session.role !== "owner") {
          return yield* new AuthError({
            message: "Only owner sessions can create pairing credentials.",
            status: 403,
          });
        }
        return yield* serverAuth.issuePairingCredential(payload);
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    )
    .handle("pairingLinks", () =>
      Effect.gen(function* () {
        const { serverAuth } = yield* authenticateOwnerSession;
        return yield* serverAuth.listPairingLinks();
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    )
    .handle("revokePairingLink", ({ payload }) =>
      Effect.gen(function* () {
        const { serverAuth } = yield* authenticateOwnerSession;
        const revoked = yield* serverAuth.revokePairingLink(payload.id);
        return { revoked };
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    )
    .handle("clients", () =>
      Effect.gen(function* () {
        const { serverAuth, session } = yield* authenticateOwnerSession;
        return yield* serverAuth.listClientSessions(session.sessionId);
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    )
    .handle("revokeClient", ({ payload }) =>
      Effect.gen(function* () {
        const { serverAuth, session } = yield* authenticateOwnerSession;
        const revoked = yield* serverAuth.revokeClientSession(session.sessionId, payload.sessionId);
        return { revoked };
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    )
    .handle("revokeOtherClients", () =>
      Effect.gen(function* () {
        const { serverAuth, session } = yield* authenticateOwnerSession;
        const revokedCount = yield* serverAuth.revokeOtherClientSessions(session.sessionId);
        return { revokedCount };
      }).pipe(Effect.catchTag("AuthError", failEnvironmentHttpAuthError)),
    ),
);
