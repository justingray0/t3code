import { CommandId, type OrchestrationSession } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";

/**
 * ProviderSessionRecovery — settle provider sessions orphaned by a restart.
 *
 * Provider sessions are backed by child processes (`grok agent stdio`,
 * `claude`, `codex app-server`, …) that do not survive a server restart, and
 * can also be killed out from under a still-running server. The persisted
 * `provider_session_runtime` row, however, keeps the last known status — so a
 * session that was mid-turn when its provider went away stays marked
 * `running`/`starting` with an unsettled turn.
 *
 * On the projection side a turn only settles when its session leaves the
 * `running` status (see `settledTurnStateForSessionStatus` in
 * `ProjectionPipeline`). With no live provider left to emit that transition,
 * the thread is stuck showing a phantom "running" turn forever and the UI will
 * not let the user continue talking.
 *
 * This recovery runs once on startup. For every persisted session still in a
 * non-terminal status it:
 *   1. dispatches a `thread.session.set` with status `ready` and no active
 *      turn, which settles the orphaned running turn (projected as
 *      `interrupted`) and unsticks the thread; and
 *   2. marks the persisted runtime row `stopped` while preserving the resume
 *      cursor, so the next prompt resumes the existing provider session
 *      (continues the conversation) instead of resuming a dead one.
 *
 * It is best-effort and idempotent: terminal rows are skipped, re-running is a
 * no-op, and a failure for one thread is logged without blocking the others or
 * server startup.
 *
 * @module provider/Layers/ProviderSessionRecovery
 */

/**
 * Persisted runtime statuses that imply a live provider process. After a
 * restart there is none, so these are the rows that need settling. `stopped`
 * and `error` are already terminal and left untouched.
 */
const NON_TERMINAL_RUNTIME_STATUSES = new Set(["starting", "running"]);

function readPersistedActiveTurnId(runtimePayload: unknown): string | null {
  if (
    runtimePayload === null ||
    typeof runtimePayload !== "object" ||
    Array.isArray(runtimePayload)
  ) {
    return null;
  }
  const activeTurnId = (runtimePayload as { activeTurnId?: unknown }).activeTurnId;
  return typeof activeTurnId === "string" && activeTurnId.length > 0 ? activeTurnId : null;
}

export const recoverOrphanedProviderSessions = Effect.gen(function* () {
  const directory = yield* ProviderSessionDirectory;
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const bindings = yield* directory.listBindings().pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("provider session recovery failed to list bindings", {
        cause: Cause.pretty(cause),
      }).pipe(Effect.as([])),
    ),
  );

  const orphaned = bindings.filter((binding) => {
    if (binding.status !== undefined && NON_TERMINAL_RUNTIME_STATUSES.has(binding.status)) {
      return true;
    }
    // Split-brain after restart: projection may already be ready while the
    // persisted runtime row still carries a stale active turn id.
    return readPersistedActiveTurnId(binding.runtimePayload) !== null;
  });

  if (orphaned.length === 0) {
    return;
  }

  yield* Effect.logInfo("recovering orphaned provider sessions on startup", {
    count: orphaned.length,
  });

  yield* Effect.forEach(
    orphaned,
    (binding) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now);
        const commandId = CommandId.make(
          `server:provider-session-recovery:${yield* crypto.randomUUIDv4}`,
        );
        const session: OrchestrationSession = {
          threadId: binding.threadId,
          status: "ready",
          providerName: binding.provider,
          ...(binding.providerInstanceId !== undefined
            ? { providerInstanceId: binding.providerInstanceId }
            : {}),
          runtimeMode: binding.runtimeMode ?? "full-access",
          // Provider turn ids are not orchestration turn ids; clearing the
          // active turn is what settles the orphaned running turn.
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        };

        // Settle the orphaned running turn (UI unstick).
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId,
          threadId: binding.threadId,
          session,
          createdAt: now,
        });

        // Mark the runtime row stopped, preserving the resume cursor so the
        // next prompt resumes this session instead of starting a dead one.
        yield* directory.upsert({
          threadId: binding.threadId,
          provider: binding.provider,
          ...(binding.providerInstanceId !== undefined
            ? { providerInstanceId: binding.providerInstanceId }
            : {}),
          status: "stopped",
          runtimePayload: {
            activeTurnId: null,
            lastRuntimeEvent: "provider.session.recovered",
            lastRuntimeEventAt: now,
          },
        });

        yield* Effect.logInfo("recovered orphaned provider session", {
          threadId: binding.threadId,
          provider: binding.provider,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider session recovery failed for thread", {
            threadId: binding.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    { concurrency: 1, discard: true },
  );
});

/**
 * Startup layer that runs {@link recoverOrphanedProviderSessions} once when
 * built. Requires `ProviderSessionDirectory` and `OrchestrationEngineService`
 * (both provided by the server runtime services layer).
 */
export const ProviderSessionRecoveryLive = Layer.effectDiscard(recoverOrphanedProviderSessions);
