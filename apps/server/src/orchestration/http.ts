import {
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpInternalServerError,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { failEnvironmentHttpAuthError } from "../auth/http.ts";
import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const failOrchestrationHttpError = (
  error: OrchestrationDispatchCommandError | OrchestrationGetSnapshotError,
) =>
  Effect.gen(function* () {
    if (error._tag === "OrchestrationGetSnapshotError") {
      yield* Effect.logError("orchestration http route failed", {
        message: error.message,
        cause: error.cause,
      });
      return yield* new EnvironmentHttpInternalServerError({ message: error.message });
    }

    return yield* new EnvironmentHttpBadRequestError({ message: error.message });
  });

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new OrchestrationDispatchCommandError({
      message: "Only owner sessions can manage projects.",
    });
  }
  return session;
});

export const orchestrationHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  (handlers) =>
    handlers
      .handle("snapshot", () =>
        Effect.gen(function* () {
          yield* authenticateOwnerSession;
          const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
          return yield* projectionSnapshotQuery.getSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration snapshot.",
                  cause,
                }),
            ),
          );
        }).pipe(
          Effect.catchTags({
            AuthError: failEnvironmentHttpAuthError,
            OrchestrationDispatchCommandError: failOrchestrationHttpError,
            OrchestrationGetSnapshotError: failOrchestrationHttpError,
          }),
        ),
      )
      .handle("dispatch", ({ payload }) =>
        Effect.gen(function* () {
          yield* authenticateOwnerSession;
          const orchestrationEngine = yield* OrchestrationEngineService;
          const normalizedCommand = yield* normalizeDispatchCommand(payload);
          return yield* orchestrationEngine.dispatch(normalizedCommand).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to dispatch orchestration command.",
                  cause,
                }),
            ),
          );
        }).pipe(
          Effect.catchTags({
            AuthError: failEnvironmentHttpAuthError,
            OrchestrationDispatchCommandError: failOrchestrationHttpError,
          }),
        ),
      ),
);
