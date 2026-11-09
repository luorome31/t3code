import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { resolveAssistantCitationRanges } from "~/lib/assistantTextSelection";
import {
  registerHighlightContribution,
  removeHighlightContribution,
} from "~/lib/highlightPainting";
import type { HighlightColor } from "~/lib/highlightColors";
import type { ThreadHighlight } from "~/highlightStore";

const SOURCE_SELECTOR = "[data-assistant-citation-source]";

function sourceElementForMutation(record: MutationRecord): Element | null {
  const target =
    record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement;
  const closest = target?.closest(SOURCE_SELECTOR);
  if (closest) return closest;
  for (const node of [...record.addedNodes, ...record.removedNodes]) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.matches(SOURCE_SELECTOR)) return element;
    const nested = element.querySelector(SOURCE_SELECTOR);
    if (nested) return nested;
  }
  return null;
}

type AssistantMessageHighlight = ThreadHighlight & {
  readonly source: { readonly kind: "assistant-message"; readonly messageId: MessageId };
};

function assistantHighlightsOf(
  highlights: readonly ThreadHighlight[],
): AssistantMessageHighlight[] {
  return highlights.filter(
    (highlight): highlight is AssistantMessageHighlight =>
      highlight.source.kind === "assistant-message",
  );
}

export function useAssistantHighlights(input: {
  readonly container: HTMLElement | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly highlights: readonly ThreadHighlight[];
}): void {
  const { container, threadRef, highlights } = input;
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const [owner] = useState<object>(() => ({}));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the shared CSS highlight registry in step with the rendered assistant rows and releases this pane's contribution on unmount
  useEffect(() => {
    if (
      container === null ||
      environmentId === null ||
      threadId === null ||
      typeof CSS === "undefined" ||
      !CSS.highlights ||
      typeof Highlight === "undefined"
    ) {
      removeHighlightContribution(owner);
      return;
    }
    const assistantHighlights = assistantHighlightsOf(highlights);
    if (assistantHighlights.length === 0) {
      removeHighlightContribution(owner);
      return;
    }

    const messageIds = new Set<string>();
    const byMessage = new Map<string, ThreadHighlight[]>();
    const priorityByColor = new Map<HighlightColor, number>();
    for (const highlight of assistantHighlights) {
      messageIds.add(highlight.source.messageId);
      const messageHighlights = byMessage.get(highlight.source.messageId);
      if (messageHighlights) messageHighlights.push(highlight);
      else byMessage.set(highlight.source.messageId, [highlight]);
      const createdAt = Date.parse(highlight.createdAt);
      const priority = 1 + (Number.isFinite(createdAt) ? createdAt / 1e13 : 0);
      priorityByColor.set(
        highlight.color,
        Math.max(priorityByColor.get(highlight.color) ?? 0, priority),
      );
    }

    const paint = () => {
      const rangesByColor = new Map<HighlightColor, Range[]>();
      for (const source of container.querySelectorAll<HTMLElement>(SOURCE_SELECTOR)) {
        if (
          source.dataset.assistantCitationEnvironment !== environmentId ||
          source.dataset.assistantCitationThread !== threadId
        ) {
          continue;
        }
        const messageId = source.dataset.assistantCitationSource;
        const messageHighlights = messageId ? byMessage.get(messageId) : undefined;
        if (!messageHighlights) continue;
        const ranges = resolveAssistantCitationRanges(
          source,
          messageHighlights.map((highlight) => highlight.selector),
        );
        for (let index = 0; index < ranges.length; index += 1) {
          const range = ranges[index];
          if (range === null || range === undefined) continue;
          const color = messageHighlights[index]!.color;
          const colorRanges = rangesByColor.get(color);
          if (colorRanges) colorRanges.push(range);
          else rangesByColor.set(color, [range]);
        }
      }
      registerHighlightContribution(owner, { rangesByColor, priorityByColor });
    };

    paint();
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        const source = sourceElementForMutation(record);
        const messageId = source?.getAttribute("data-assistant-citation-source");
        return messageId !== null && messageId !== undefined && messageIds.has(messageId);
      });
      if (relevant) paint();
    });
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      removeHighlightContribution(owner);
    };
  }, [container, environmentId, highlights, owner, threadId]);
}
