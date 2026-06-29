/**
 * End-to-end Cursor resume tests against a real `agent acp` install.
 *
 * Enable with:
 *   T3_CURSOR_RESUME_E2E=1 vp test cursorResume.integration
 *
 * Uses composer-2.5 with fast mode disabled. The second turn intentionally
 * asks the agent to run a shell command so we exercise tool calls after
 * session/load resume, not just plain text replies.
 */
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";

const PROJECT_ID = ProjectId.make("project-cursor-resume");
const THREAD_ID = ThreadId.make("thread-cursor-resume");
const CURSOR_PROVIDER = ProviderDriverKind.make("cursor");
const CURSOR_INSTANCE = ProviderInstanceId.make("cursor");
const CURSOR_MODEL = createModelSelection(CURSOR_INSTANCE, "composer-2.5", [
  { id: "fastMode", value: false },
]);

const MARKER_ONE = "CURSOR_RESUME_MARKER_ONE";
const MARKER_TWO = "CURSOR_RESUME_MARKER_TWO";
const TURN_TIMEOUT_MS = 300_000;

const asMessageId = (value: string): MessageId => MessageId.make(value);

function completedAssistantMessages(thread: {
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly streaming: boolean;
  }>;
}) {
  return thread.messages.filter(
    (message) =>
      message.role === "assistant" && !message.streaming && message.text.trim().length > 0,
  );
}

function lastCompletedAssistantText(thread: {
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly streaming: boolean;
  }>;
}): string | undefined {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message?.role === "assistant" && !message.streaming && message.text.trim().length > 0) {
      return message.text;
    }
  }
  return undefined;
}

function hasToolActivity(thread: {
  readonly activities: ReadonlyArray<{ readonly kind: string }>;
}): boolean {
  return thread.activities.some(
    (activity) => activity.kind === "tool.started" || activity.kind === "tool.completed",
  );
}

const seedCursorProjectAndThread = (harness: OrchestrationIntegrationHarness) =>
  Effect.gen(function* () {
    const createdAt = "2026-06-29T12:00:00.000Z";

    yield* harness.engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("cmd-project-create-cursor-resume"),
      projectId: PROJECT_ID,
      title: "Cursor Resume Project",
      workspaceRoot: harness.workspaceDir,
      defaultModelSelection: CURSOR_MODEL,
      createdAt,
    });

    yield* harness.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("cmd-thread-create-cursor-resume"),
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Cursor Resume Thread",
      modelSelection: CURSOR_MODEL,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: harness.workspaceDir,
      createdAt,
    });
  });

const startCursorTurn = (input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly commandId: string;
  readonly messageId: string;
  readonly text: string;
}) =>
  input.harness.engine.dispatch({
    type: "thread.turn.start",
    commandId: CommandId.make(input.commandId),
    threadId: THREAD_ID,
    message: {
      messageId: asMessageId(input.messageId),
      role: "user",
      text: input.text,
      attachments: [],
    },
    modelSelection: CURSOR_MODEL,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "full-access",
    createdAt: "2026-06-29T12:00:01.000Z",
  });

function withRealCursorHarness<A, E>(
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E>,
) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({
      provider: CURSOR_PROVIDER,
      realCursor: true,
    }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

it.live.skipIf(process.env.T3_CURSOR_RESUME_E2E !== "1")(
  "resumes a cursor session after stopSession and completes a tool-using turn with a final assistant message",
  () =>
    withRealCursorHarness((harness) =>
      Effect.gen(function* () {
        yield* seedCursorProjectAndThread(harness);

        yield* startCursorTurn({
          harness,
          commandId: "cmd-cursor-resume-turn-1",
          messageId: "msg-cursor-resume-1",
          text: `Run the shell command \`ls\` in the workspace, then reply with one line that contains exactly ${MARKER_ONE}.`,
        });

        const firstThread = yield* harness.waitForThread(
          THREAD_ID,
          (entry) =>
            entry.session?.status === "ready" &&
            entry.session.providerName === "cursor" &&
            lastCompletedAssistantText(entry)?.includes(MARKER_ONE) === true,
          TURN_TIMEOUT_MS,
        );
        assert.equal(firstThread.session?.providerName, "cursor");
        const firstAssistants = completedAssistantMessages(firstThread);
        assert.equal(
          firstAssistants.some((message) => message.text.includes(MARKER_ONE)),
          true,
        );

        yield* harness.providerService.stopSession({ threadId: THREAD_ID });

        yield* startCursorTurn({
          harness,
          commandId: "cmd-cursor-resume-turn-2",
          messageId: "msg-cursor-resume-2",
          text: `Run the shell command \`pwd\` in the workspace, then reply with one line that contains exactly ${MARKER_TWO}.`,
        });

        const resumedThread = yield* harness.waitForThread(
          THREAD_ID,
          (entry) => {
            if (entry.session?.status !== "ready" || entry.session.providerName !== "cursor") {
              return false;
            }
            const assistantText = lastCompletedAssistantText(entry);
            return (
              assistantText?.includes(MARKER_TWO) === true &&
              !entry.activities.some((activity) => activity.kind === "provider.turn.start.failed")
            );
          },
          TURN_TIMEOUT_MS,
        );

        const finalAssistantText = lastCompletedAssistantText(resumedThread);
        const markerOneMessage = completedAssistantMessages(resumedThread).find((message) =>
          message.text.includes(MARKER_ONE),
        );
        const lastAssistant = completedAssistantMessages(resumedThread).at(-1);
        assert.equal(finalAssistantText?.includes(MARKER_TWO), true);
        assert.equal(markerOneMessage?.text.includes(MARKER_TWO), false);
        assert.equal(lastAssistant?.text.includes(MARKER_TWO), true);
        assert.equal(lastAssistant?.text.includes(MARKER_ONE), false);
        assert.equal(
          resumedThread.activities.some(
            (activity) => activity.kind === "provider.turn.start.failed",
          ),
          false,
        );
        // The regression we are guarding: tool calls happen but the final assistant
        // segment never lands in the projection after session/load resume.
        assert.equal(hasToolActivity(resumedThread), true);
      }),
    ),
);
