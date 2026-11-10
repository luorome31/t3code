import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";
import { useLayoutEffect, useState } from "react";
import { useQuietThreadShell, useTimelineVisibleTurnItems } from "../../state/entities";
import {
  cachedMessageOutline,
  readMessageOutline,
  type MessageOutlineHeading,
} from "./messageOutline";
import { useOutlineStore } from "./outlineStore";

const NO_HEADINGS: readonly MessageOutlineHeading[] = [];

export type ActiveOutline =
  | {
      readonly status: "no-replies";
      readonly messageId: null;
      readonly headings: typeof NO_HEADINGS;
    }
  | { readonly status: "no-reply"; readonly messageId: null; readonly headings: typeof NO_HEADINGS }
  | { readonly status: "working"; readonly messageId: null; readonly headings: typeof NO_HEADINGS }
  | {
      readonly status: "streaming" | "reading" | "unavailable" | "no-headings";
      readonly messageId: MessageId;
      readonly headings: typeof NO_HEADINGS;
    }
  | {
      readonly status: "ready";
      readonly messageId: MessageId;
      readonly headings: readonly MessageOutlineHeading[];
    };

interface OutlineSnapshot {
  readonly messageId: MessageId;
  readonly updatedAt: DateTime.Utc | null;
  readonly headings: readonly MessageOutlineHeading[] | null;
}

export function useActiveOutline(threadRef: ScopedThreadRef | null): ActiveOutline {
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const activeMessageId = useOutlineStore((state) =>
    threadKey === null ? null : (state.byThreadKey[threadKey]?.activeMessageId ?? null),
  );
  const visibleItems = useTimelineVisibleTurnItems(threadRef);
  const shell = useQuietThreadShell(threadRef);
  const threadWorking = threadRuntimeIsActive(shell?.runtime);
  const lastAssistant = visibleItems.findLast(
    (visible) => visible.item.type === "assistant_message",
  );
  const lastAssistantMessageId =
    lastAssistant?.item.type === "assistant_message" ? lastAssistant.item.messageId : null;
  const activeItem =
    activeMessageId === null
      ? undefined
      : visibleItems.find(
          (visible) =>
            visible.item.type === "assistant_message" && visible.item.messageId === activeMessageId,
        )?.item;
  const streaming = activeItem?.type === "assistant_message" ? activeItem.streaming : false;
  const updatedAt = activeItem?.type === "assistant_message" ? activeItem.updatedAt : null;
  const [snapshot, setSnapshot] = useState<OutlineSnapshot | null>(null);
  const cachedHeadings =
    activeMessageId === null ? undefined : cachedMessageOutline(activeMessageId, updatedAt);
  const currentSnapshot =
    snapshot?.messageId === activeMessageId && snapshot.updatedAt === updatedAt
      ? snapshot
      : activeMessageId !== null && cachedHeadings !== undefined
        ? { messageId: activeMessageId, updatedAt, headings: cachedHeadings }
        : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the reply's headings from rendered DOM, which React does not own
  useLayoutEffect(() => {
    if (
      activeMessageId === null ||
      streaming ||
      (threadWorking && activeMessageId === lastAssistantMessageId) ||
      cachedHeadings !== undefined
    ) {
      return;
    }
    let cancelled = false;
    let frame = 0;
    const read = (attempt: number) => {
      if (cancelled) return;
      const headings = readMessageOutline(activeMessageId, updatedAt);
      if (headings !== null || attempt >= 2) {
        setSnapshot({ messageId: activeMessageId, updatedAt, headings });
      }
      // The row can mount a frame after the active id on thread open or list restore.
      if (headings === null && attempt < 2) {
        frame = requestAnimationFrame(() => read(attempt + 1));
      }
    };
    frame = requestAnimationFrame(() => read(0));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [
    activeMessageId,
    cachedHeadings,
    lastAssistantMessageId,
    streaming,
    threadWorking,
    updatedAt,
  ]);

  if (activeMessageId === null || activeItem === undefined) {
    if (threadWorking) return { status: "working", messageId: null, headings: NO_HEADINGS };
    return lastAssistant === undefined
      ? { status: "no-replies", messageId: null, headings: NO_HEADINGS }
      : { status: "no-reply", messageId: null, headings: NO_HEADINGS };
  }
  if (streaming || (threadWorking && activeMessageId === lastAssistantMessageId)) {
    return { status: "streaming", messageId: activeMessageId, headings: NO_HEADINGS };
  }
  if (currentSnapshot === null) {
    return { status: "reading", messageId: activeMessageId, headings: NO_HEADINGS };
  }
  if (currentSnapshot.headings === null) {
    return { status: "unavailable", messageId: activeMessageId, headings: NO_HEADINGS };
  }
  if (currentSnapshot.headings.length === 0) {
    return { status: "no-headings", messageId: activeMessageId, headings: NO_HEADINGS };
  }
  return { status: "ready", messageId: activeMessageId, headings: currentSnapshot.headings };
}
