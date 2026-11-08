import type { LegendListRef } from "@legendapp/list/react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useRef, type RefObject } from "react";
import { useQuietThreadProjection, useThreadHistory } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useStableCallback } from "../../hooks/useStableCallback";
import { measuredEndOffset, settleListScroll } from "./useTimelinePositionRestore";
import { CHAT_TIMELINE_ANCHOR_OFFSET } from "./timelineScrollAnchoring";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  attachQuestionTimeline,
  EMPTY_QUESTION_NAVIGATION,
  settleQuestionNavigation,
  useQuestionOutlineStore,
} from "./questionOutlineStore";

export function useQuestionTimeline(input: {
  readonly enabled: boolean;
  readonly threadKey: string;
  readonly viewport: HTMLElement | null;
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly navigate: () => void;
}) {
  const { enabled, threadKey, viewport, rows, listRef } = input;
  const request = useQuestionOutlineStore((state) =>
    enabled ? (state.byThreadKey[threadKey]?.request ?? null) : null,
  );
  // A draft's thread id is reserved before the server creates it. Reading its history
  // or projection here would 404 and leave the later real thread stuck as deleted.
  const ref = request === null ? null : parseScopedThreadKey(threadKey);
  const history = useThreadHistory(ref);
  const thread = useQuietThreadProjection(ref);
  const targetLoaded =
    request !== null &&
    (thread?.projection.visibleTurnItems.some(
      ({ item }) => item.type === "user_message" && item.messageId === request.question.messageId,
    ) ??
      false);
  const loadEarlier = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load question history",
    reportFailure: false,
  });
  const navigate = useStableCallback(input.navigate);
  const load = useStableCallback(loadEarlier);
  const attemptedRef = useRef<string | null>(null);
  const scrollingRef = useRef<number | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the mounted viewport for directory actions and cancels pending navigation on manual scrolling
  useEffect(() => {
    if (!enabled || !viewport) return;
    attemptedRef.current = null;
    scrollingRef.current = null;
    const detach = attachQuestionTimeline(threadKey, navigate);
    const cancel = () => {
      const pending = useQuestionOutlineStore.getState().byThreadKey[threadKey]?.request;
      if (pending) settleQuestionNavigation(threadKey, pending.id, null);
    };
    const key = (event: KeyboardEvent) => {
      if (
        ["Escape", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        cancel();
    };
    const pointer = (event: PointerEvent) => {
      if (event.target === listRef.current?.getScrollableNode()) cancel();
    };
    viewport.addEventListener("wheel", cancel, { passive: true });
    viewport.addEventListener("touchmove", cancel, { passive: true });
    viewport.addEventListener("keydown", key);
    viewport.addEventListener("pointerdown", pointer);
    return () => {
      detach();
      viewport.removeEventListener("wheel", cancel);
      viewport.removeEventListener("touchmove", cancel);
      viewport.removeEventListener("keydown", key);
      viewport.removeEventListener("pointerdown", pointer);
    };
  }, [enabled, listRef, navigate, threadKey, viewport]);

  const targetIndex =
    request === null
      ? -1
      : rows.findIndex(
          (row) => row.kind === "message" && row.message.id === request.question.messageId,
        );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads a requested history target and positions the external virtual list after its rows commit
  useEffect(() => {
    if (!request || !ref || !viewport) return;
    if (targetIndex < 0) {
      if (history.loading || targetLoaded) return;
      const loadKey = `${request.id}:${history.historyCursor}`;
      if (attemptedRef.current === loadKey) return;
      if (!history.hasMoreHistory) {
        settleQuestionNavigation(
          threadKey,
          request.id,
          "This question is no longer in the conversation. Refresh the outline and try again.",
        );
        return;
      }
      attemptedRef.current = loadKey;
      void load({
        environmentId: ref.environmentId,
        input: {
          threadId: ref.threadId,
          throughEntryId: request.question.messageId,
        },
      }).then((result) => {
        if (useQuestionOutlineStore.getState().byThreadKey[threadKey]?.request !== request) return;
        if (result._tag === "Failure" || result.value._tag === "error") {
          settleQuestionNavigation(
            threadKey,
            request.id,
            "Could not load this question. Try again.",
          );
        } else if (result.value._tag === "noop") {
          settleQuestionNavigation(
            threadKey,
            request.id,
            "This question is no longer available. Refresh the outline and try again.",
          );
        } else if (result.value._tag === "busy") {
          attemptedRef.current = null;
        }
      });
      return;
    }
    const list = listRef.current;
    if (!list || list.getState().data !== rows || scrollingRef.current === request.id) return;
    scrollingRef.current = request.id;
    navigate();
    void Promise.resolve(
      list.scrollToIndex({
        index: targetIndex,
        animated: false,
        viewOffset: CHAT_TIMELINE_ANCHOR_OFFSET,
      }),
    ).then(
      async () => {
        await settleListScroll(
          list,
          (element) => {
            const state = list.getState();
            const index = state.indexByKey(rows[targetIndex]!.id);
            const row = index === undefined ? undefined : state.elementAtIndex(index);
            return row
              ? Math.max(
                  0,
                  Math.min(
                    element.scrollTop +
                      row.getBoundingClientRect().top -
                      element.getBoundingClientRect().top -
                      CHAT_TIMELINE_ANCHOR_OFFSET,
                    measuredEndOffset(element),
                  ),
                )
              : undefined;
          },
          () => useQuestionOutlineStore.getState().byThreadKey[threadKey]?.request !== request,
        );
        const current =
          useQuestionOutlineStore.getState().byThreadKey[threadKey] ?? EMPTY_QUESTION_NAVIGATION;
        if (current.request !== request) return;
        navigate();
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const element = viewport.querySelector<HTMLElement>(
            `[data-message-id="${CSS.escape(request.question.messageId)}"]`,
          );
          element?.animate([{ opacity: 0.55 }, { opacity: 1 }], {
            duration: 650,
            easing: "ease-out",
          });
        }
        settleQuestionNavigation(threadKey, request.id, null);
      },
      () =>
        settleQuestionNavigation(
          threadKey,
          request.id,
          "Could not jump to this question. Try again.",
        ),
    );
  }, [
    history.hasMoreHistory,
    history.historyCursor,
    history.loading,
    listRef,
    load,
    navigate,
    ref,
    request,
    rows,
    targetIndex,
    targetLoaded,
    threadKey,
    viewport,
  ]);

  return targetIndex < 0 ? null : (rows[targetIndex]?.id ?? null);
}
