import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  OrchestrationThread,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  RuntimeMode,
  ServerConfig as T3ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import { formatElapsed } from "@t3tools/shared/orchestrationTiming";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { runOnJS } from "react-native-reanimated";

import { AppText as Text } from "../../components/AppText";
import type { StatusTone } from "../../components/StatusPill";
import type { DraftComposerImageAttachment } from "../../lib/composerImages";
import type { MobileLayoutVariant } from "../../lib/mobileLayout";
import type {
  PendingApproval,
  PendingUserInput,
  PendingUserInputDraftAnswer,
  ThreadFeedEntry,
} from "../../lib/threadActivity";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { PendingUserInputCard } from "./PendingUserInputCard";
import {
  COMPOSER_COLLAPSED_CHROME,
  COMPOSER_EXPANDED_CHROME,
  COMPOSER_EXPANDED_TOOLBAR_CHROME,
  ThreadComposer,
} from "./ThreadComposer";
import { ThreadFeed } from "./ThreadFeed";

export interface ThreadDetailScreenProps {
  readonly selectedThread: OrchestrationThread;
  readonly screenTone: StatusTone;
  readonly connectionError: string | null;
  readonly httpBaseUrl: string | null;
  readonly bearerToken: string | null;
  readonly selectedThreadFeed: ReadonlyArray<ThreadFeedEntry>;
  readonly activeWorkStartedAt: string | null;
  readonly activePendingApproval: PendingApproval | null;
  readonly respondingApprovalId: ApprovalRequestId | null;
  readonly activePendingUserInput: PendingUserInput | null;
  readonly activePendingUserInputDrafts: Record<string, PendingUserInputDraftAnswer>;
  readonly activePendingUserInputAnswers: Record<string, string> | null;
  readonly respondingUserInputId: ApprovalRequestId | null;
  readonly draftMessage: string;
  readonly draftAttachments: ReadonlyArray<DraftComposerImageAttachment>;
  readonly connectionStateLabel: "ready" | "connecting" | "reconnecting" | "disconnected" | "idle";
  readonly connectionReconnectAttempt: number;
  readonly activeThreadBusy: boolean;
  readonly environmentId: EnvironmentId;
  readonly projectWorkspaceRoot: string | null;
  readonly selectedThreadQueueCount: number;
  readonly serverConfig: T3ServerConfig | null;
  readonly layoutVariant?: MobileLayoutVariant;
  readonly onOpenDrawer: () => void;
  readonly onOpenConnectionEditor: () => void;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly onPickDraftImages: () => Promise<void>;
  readonly onNativePasteImages: (uris: ReadonlyArray<string>) => Promise<void>;
  readonly onRemoveDraftImage: (imageId: string) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onStopThread: () => Promise<void>;
  readonly onSendMessage: () => void;
  readonly onUpdateThreadModelSelection: (modelSelection: ModelSelection) => Promise<void>;
  readonly onUpdateThreadRuntimeMode: (runtimeMode: RuntimeMode) => Promise<void>;
  readonly onUpdateThreadInteractionMode: (
    interactionMode: ProviderInteractionMode,
  ) => Promise<void>;
  readonly onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
  readonly onSelectUserInputOption: (
    requestId: ApprovalRequestId,
    questionId: string,
    label: string,
  ) => void;
  readonly onChangeUserInputCustomAnswer: (
    requestId: ApprovalRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmitUserInput: () => Promise<void>;
  readonly showContent?: boolean;
}

function latestStreamingAssistantMessage(
  feed: ReadonlyArray<ThreadFeedEntry>,
): { readonly id: string; readonly textLength: number } | null {
  for (let index = feed.length - 1; index >= 0; index -= 1) {
    const entry = feed[index];
    if (entry?.type !== "message") {
      continue;
    }
    if (entry.message.role !== "assistant" || !entry.message.streaming) {
      continue;
    }
    return {
      id: entry.message.id,
      textLength: entry.message.text.length,
    };
  }

  return null;
}

function useStreamingHaptics(threadId: ThreadId, feed: ReadonlyArray<ThreadFeedEntry>) {
  const lastStreamingAssistantRef = useRef<{
    readonly id: string;
    readonly textLength: number;
  } | null>(null);
  const lastStreamHapticAtRef = useRef(0);
  const hydratedRef = useRef(false);
  const previousThreadIdRef = useRef(threadId);

  useEffect(() => {
    if (previousThreadIdRef.current !== threadId) {
      previousThreadIdRef.current = threadId;
      hydratedRef.current = false;
    }

    const latestStreamingMessage = latestStreamingAssistantMessage(feed);

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      lastStreamingAssistantRef.current = latestStreamingMessage;
      return;
    }

    if (!latestStreamingMessage) {
      lastStreamingAssistantRef.current = null;
      return;
    }

    const previousStreamingMessage = lastStreamingAssistantRef.current;
    lastStreamingAssistantRef.current = latestStreamingMessage;

    const isNewStream = previousStreamingMessage?.id !== latestStreamingMessage.id;
    const textGrew =
      previousStreamingMessage?.id === latestStreamingMessage.id &&
      latestStreamingMessage.textLength > previousStreamingMessage.textLength;

    if (!isNewStream && !textGrew) {
      return;
    }

    const now = Date.now();
    if (!isNewStream && now - lastStreamHapticAtRef.current < 320) {
      return;
    }

    lastStreamHapticAtRef.current = now;
    void Haptics.selectionAsync();
  }, [threadId, feed]);
}

const WORKING_INDICATOR_HEIGHT = 44;

type ConnectionStateLabel = "ready" | "connecting" | "reconnecting" | "disconnected" | "idle";

function describeConnectionBanner(
  state: ConnectionStateLabel,
  error: string | null,
  attempt: number,
): { readonly title: string; readonly detail: string | null } | null {
  const attemptSuffix = attempt > 1 ? ` (attempt ${attempt})` : "";
  switch (state) {
    case "ready":
      return null;
    case "connecting":
      return { title: `Connecting to remote server…${attemptSuffix}`, detail: null };
    case "reconnecting":
      return {
        title: `Reconnecting to remote server…${attemptSuffix}`,
        detail: "Activity may be paused until the connection recovers.",
      };
    case "disconnected":
    case "idle": {
      const detailParts = [
        error ?? "Pull down to refresh or wait — the app will keep retrying in the background.",
      ];
      if (attempt > 0) {
        detailParts.push(`Reconnect attempts: ${attempt}.`);
      }
      return {
        title: "Disconnected from remote server",
        detail: detailParts.join(" "),
      };
    }
  }
}

const ConnectionStatusBanner = memo(function ConnectionStatusBanner(props: {
  readonly state: ConnectionStateLabel;
  readonly error: string | null;
  readonly reconnectAttempt: number;
}) {
  const banner = describeConnectionBanner(props.state, props.error, props.reconnectAttempt);
  if (!banner) {
    return null;
  }
  const isError = props.state === "disconnected" || props.state === "idle";
  const containerClass = isError
    ? "self-stretch rounded-2xl border border-red-300/70 bg-red-50/95 px-3 py-2 dark:border-red-500/40 dark:bg-red-500/10"
    : "self-stretch rounded-2xl border border-amber-300/70 bg-amber-50/95 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10";
  const titleClass = isError
    ? "font-t3-medium text-[13px] text-red-700 dark:text-red-200"
    : "font-t3-medium text-[13px] text-amber-700 dark:text-amber-200";
  const detailClass = isError
    ? "text-[12px] text-red-700/80 dark:text-red-200/80"
    : "text-[12px] text-amber-700/80 dark:text-amber-200/80";
  return (
    <View className="px-4 pb-2" style={{ flexShrink: 0 }}>
      <View className={containerClass}>
        <Text className={titleClass}>{banner.title}</Text>
        {banner.detail ? <Text className={detailClass}>{banner.detail}</Text> : null}
      </View>
    </View>
  );
});

const WorkingDurationPill = memo(function WorkingDurationPill(props: {
  readonly startedAt: string;
  readonly connectionState: ConnectionStateLabel;
  readonly reconnectAttempt: number;
}) {
  const isConnected = props.connectionState === "ready";
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    setNowMs(Date.now());
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => clearInterval(intervalId);
  }, [isConnected, props.startedAt]);

  const durationLabel = formatElapsed(props.startedAt, new Date(nowMs).toISOString()) ?? "0s";

  if (!isConnected) {
    const attemptSuffix =
      props.reconnectAttempt > 0 ? ` · retry ${props.reconnectAttempt}` : "";
    return (
      <View className="px-4 pb-2" style={{ flexShrink: 0 }}>
        <View className="self-start rounded-full border border-amber-300/70 bg-amber-50/90 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10">
          <Text className="font-t3-medium text-xs text-amber-700 dark:text-amber-200">
            Last seen working for {durationLabel} · paused (disconnected){attemptSuffix}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="px-4 pb-2" style={{ flexShrink: 0 }}>
      <View className="self-start rounded-full border border-neutral-200/80 bg-neutral-50/90 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.04]">
        <View className="flex-row items-center gap-2">
          <View className="flex-row items-center gap-1">
            <View className="h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
            <View className="h-1.5 w-1.5 rounded-full bg-neutral-400/80 dark:bg-neutral-500/80" />
            <View className="h-1.5 w-1.5 rounded-full bg-neutral-400/60 dark:bg-neutral-500/60" />
          </View>
          <Text className="font-t3-medium text-xs text-neutral-600 dark:text-neutral-400">
            Working for {durationLabel}
          </Text>
        </View>
      </View>
    </View>
  );
});

export const ThreadDetailScreen = memo(function ThreadDetailScreen(props: ThreadDetailScreenProps) {
  const { onOpenDrawer, onRefresh } = props;

  const insets = useSafeAreaInsets();
  const agentLabel = `${props.selectedThread.modelSelection.instanceId} agent`;
  const composerBottomInset = Math.max(insets.bottom, 12);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const composerChrome = composerExpanded ? COMPOSER_EXPANDED_CHROME : COMPOSER_COLLAPSED_CHROME;
  const composerOverlapHeight = composerChrome + composerBottomInset;
  const activeWorkIndicatorHeight = props.activeWorkStartedAt ? WORKING_INDICATOR_HEIGHT : 0;
  const estimatedOverlayHeight = composerOverlapHeight + activeWorkIndicatorHeight;
  const [measuredOverlayHeight, setMeasuredOverlayHeight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const showContent = props.showContent ?? true;
  const layoutVariant = props.layoutVariant ?? "compact";
  const isSplitLayout = layoutVariant === "split";
  useStreamingHaptics(props.selectedThread.id, props.selectedThreadFeed);
  const expandedToolbarInset = composerExpanded ? COMPOSER_EXPANDED_TOOLBAR_CHROME : 0;
  const feedBottomInset =
    Math.max(estimatedOverlayHeight, measuredOverlayHeight) + expandedToolbarInset + 8;

  const completeDrawerGesture = useCallback(() => {
    void Haptics.selectionAsync();
    onOpenDrawer();
  }, [onOpenDrawer]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    if (refreshing) {
      return;
    }

    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, refreshing]);

  const drawerGestureThreshold = 80;
  const headerDrawerGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isSplitLayout)
        .hitSlop({ left: 0, width: 40 })
        .activeOffsetX([10, 999])
        .failOffsetY([-24, 24])
        .onEnd((event) => {
          const translationX = Math.max(event.translationX, 0);
          if (event.y < drawerGestureThreshold && translationX > 56) {
            runOnJS(completeDrawerGesture)();
          }
        }),
    [completeDrawerGesture, isSplitLayout],
  );

  const handleOverlayLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setMeasuredOverlayHeight((current) =>
      Math.abs(current - nextHeight) > 1 ? nextHeight : current,
    );
  }, []);

  return (
    <GestureDetector gesture={headerDrawerGesture}>
      <View className="flex-1">
        {showContent ? (
          <ThreadFeed
            threadId={props.selectedThread.id}
            feed={props.selectedThreadFeed}
            httpBaseUrl={props.httpBaseUrl}
            bearerToken={props.bearerToken}
            agentLabel={agentLabel}
            contentBottomInset={feedBottomInset}
            layoutVariant={layoutVariant}
            composerExpanded={composerExpanded}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        ) : (
          <View style={{ flex: 1 }} />
        )}

        {/* Floating composer — sticks to keyboard via KeyboardStickyView */}
        {showContent ? (
          <KeyboardStickyView
            style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
            offset={{ closed: 0, opened: 0 }}
          >
            <View onLayout={handleOverlayLayout}>
              <ConnectionStatusBanner
                state={props.connectionStateLabel}
                error={props.connectionError}
                reconnectAttempt={props.connectionReconnectAttempt}
              />
              {props.activeWorkStartedAt ? (
                <WorkingDurationPill
                  startedAt={props.activeWorkStartedAt}
                  connectionState={props.connectionStateLabel}
                  reconnectAttempt={props.connectionReconnectAttempt}
                />
              ) : null}

              {props.activePendingApproval || props.activePendingUserInput ? (
                <View className="gap-3 px-4 pb-3" style={{ flexShrink: 0 }}>
                  {props.activePendingApproval ? (
                    <PendingApprovalCard
                      approval={props.activePendingApproval}
                      respondingApprovalId={props.respondingApprovalId}
                      onRespond={props.onRespondToApproval}
                    />
                  ) : null}
                  {props.activePendingUserInput ? (
                    <PendingUserInputCard
                      pendingUserInput={props.activePendingUserInput}
                      drafts={props.activePendingUserInputDrafts}
                      answers={props.activePendingUserInputAnswers}
                      respondingUserInputId={props.respondingUserInputId}
                      onSelectOption={props.onSelectUserInputOption}
                      onChangeCustomAnswer={props.onChangeUserInputCustomAnswer}
                      onSubmit={props.onSubmitUserInput}
                    />
                  ) : null}
                </View>
              ) : null}

              <ThreadComposer
                draftMessage={props.draftMessage}
                draftAttachments={props.draftAttachments}
                placeholder="Ask the repo agent, or run a command…"
                connectionState={props.connectionStateLabel}
                selectedThread={props.selectedThread}
                serverConfig={props.serverConfig}
                queueCount={props.selectedThreadQueueCount}
                activeThreadBusy={props.activeThreadBusy}
                environmentId={props.environmentId}
                projectCwd={props.projectWorkspaceRoot}
                bottomInset={composerBottomInset}
                onChangeDraftMessage={props.onChangeDraftMessage}
                onPickDraftImages={props.onPickDraftImages}
                onNativePasteImages={props.onNativePasteImages}
                onRemoveDraftImage={props.onRemoveDraftImage}
                onRefresh={props.onRefresh}
                onStopThread={props.onStopThread}
                onSendMessage={props.onSendMessage}
                onUpdateModelSelection={props.onUpdateThreadModelSelection}
                onUpdateRuntimeMode={props.onUpdateThreadRuntimeMode}
                onUpdateInteractionMode={props.onUpdateThreadInteractionMode}
                onExpandedChange={setComposerExpanded}
              />
            </View>
          </KeyboardStickyView>
        ) : null}
      </View>
    </GestureDetector>
  );
});
