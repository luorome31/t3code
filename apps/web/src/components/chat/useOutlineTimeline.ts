import type { LegendListRef } from "@legendapp/list/react";
import { type RefObject, useEffect, useRef } from "react";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { outlineHeadingElements } from "./messageOutline";
import { attachOutlineTimeline, settleOutlineNavigation, useOutlineStore } from "./outlineStore";
import { CHAT_TIMELINE_ANCHOR_OFFSET } from "./timelineScrollAnchoring";
import { measuredEndOffset, settleListScroll } from "./useTimelinePositionRestore";
import { useStableCallback } from "~/hooks/useStableCallback";

const OUTLINE_NAVIGATION_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

export function useOutlineTimeline(input: {
  readonly enabled: boolean;
  readonly threadKey: string;
  readonly viewport: HTMLElement | null;
  readonly rows: ReadonlyArray<MessagesTimelineRow>;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly navigate: () => void;
}) {
  const { enabled, threadKey, viewport, rows, listRef } = input;
  const request = useOutlineStore((state) =>
    enabled ? (state.byThreadKey[threadKey]?.request ?? null) : null,
  );
  const navigate = useStableCallback(input.navigate);
  const scrollingRef = useRef<number | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the mounted timeline as the heading jump target
  useEffect(() => {
    if (!enabled) return;
    return attachOutlineTimeline(threadKey, navigate);
  }, [enabled, navigate, threadKey]);

  const targetIndex =
    request === null
      ? -1
      : rows.findIndex((row) => row.kind === "message" && row.message.id === request.messageId);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- positions the external virtual list after a heading request
  useEffect(() => {
    if (!request) {
      scrollingRef.current = null;
      return;
    }
    const list = listRef.current;
    if (!list) return;
    if (targetIndex < 0) {
      settleOutlineNavigation(
        threadKey,
        request.id,
        "This section is no longer available. Refresh the outline and try again.",
      );
      return;
    }
    if (scrollingRef.current === request.id) return;
    scrollingRef.current = request.id;
    navigate();
    const isCancelled = () =>
      useOutlineStore.getState().byThreadKey[threadKey]?.request !== request;
    let found = false;
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
            const rowIndex = state.indexByKey(rows[targetIndex]!.id);
            const row = rowIndex === undefined ? undefined : state.elementAtIndex(rowIndex);
            // Mounting and details layout can land a frame after `scrollToIndex`.
            if (!(row instanceof HTMLElement)) return element.scrollTop;
            const markdown = row.querySelector<HTMLElement>(".chat-markdown");
            const heading = markdown
              ? outlineHeadingElements(markdown)[request.headingIndex]
              : undefined;
            if (!heading) return element.scrollTop;
            const details = heading.closest("details");
            if (details && !details.open) details.open = true;
            if (heading.getClientRects().length === 0) return element.scrollTop;
            found = true;
            return Math.max(
              0,
              Math.min(
                element.scrollTop +
                  heading.getBoundingClientRect().top -
                  element.getBoundingClientRect().top -
                  CHAT_TIMELINE_ANCHOR_OFFSET,
                measuredEndOffset(element),
              ),
            );
          },
          isCancelled,
        );
        if (isCancelled()) return;
        settleOutlineNavigation(
          threadKey,
          request.id,
          found ? null : "Could not find this section in the reply.",
        );
      },
      () => {
        if (isCancelled()) return;
        settleOutlineNavigation(
          threadKey,
          request.id,
          "Could not jump to this section. Try again.",
        );
      },
    );
  }, [listRef, navigate, request, rows, targetIndex, threadKey]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels a pending outline jump when the user starts scrolling
  useEffect(() => {
    if (!request || !viewport) return;
    const cancel = () => settleOutlineNavigation(threadKey, request.id, null);
    const key = (event: KeyboardEvent) => {
      if (OUTLINE_NAVIGATION_KEYS.has(event.key)) cancel();
    };
    viewport.addEventListener("wheel", cancel, { passive: true });
    viewport.addEventListener("touchmove", cancel, { passive: true });
    viewport.addEventListener("pointerdown", cancel);
    viewport.addEventListener("keydown", key);
    return () => {
      viewport.removeEventListener("wheel", cancel);
      viewport.removeEventListener("touchmove", cancel);
      viewport.removeEventListener("pointerdown", cancel);
      viewport.removeEventListener("keydown", key);
    };
  }, [request, threadKey, viewport]);

  return targetIndex < 0 ? null : (rows[targetIndex]?.id ?? null);
}
