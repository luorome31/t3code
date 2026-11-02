import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { resolveAssistantCitationRange } from "~/lib/assistantTextSelection";
import {
  HIGHLIGHT_COLORS,
  highlightRegistryName,
  type HighlightColor,
} from "~/lib/highlightColors";
import type { ThreadHighlight } from "~/highlightStore";

const SOURCE_SELECTOR = "[data-assistant-citation-source]";

function affectsSource(record: MutationRecord): boolean {
  const target =
    record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement;
  if (target?.closest(SOURCE_SELECTOR)) return true;
  const touchesSource = (node: Node) =>
    node.nodeType === 1 &&
    ((node as Element).matches(SOURCE_SELECTOR) ||
      (node as Element).querySelector(SOURCE_SELECTOR) !== null);
  return [...record.addedNodes, ...record.removedNodes].some(touchesSource);
}

export function useAssistantHighlights(input: {
  readonly container: HTMLElement | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly highlights: readonly ThreadHighlight[];
}): void {
  const { container, threadRef, highlights } = input;
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the CSS highlight registry in step with the rendered assistant rows and clears it on unmount
  useEffect(() => {
    if (
      container === null ||
      environmentId === null ||
      threadId === null ||
      typeof CSS === "undefined" ||
      !CSS.highlights ||
      typeof Highlight === "undefined"
    ) {
      return;
    }
    const registry = CSS.highlights;
    const clear = () => {
      for (const color of HIGHLIGHT_COLORS) registry.delete(highlightRegistryName(color.id));
    };
    if (highlights.length === 0) {
      clear();
      return;
    }

    const byMessage = new Map<string, ThreadHighlight[]>();
    for (const highlight of highlights) {
      const messageHighlights = byMessage.get(highlight.messageId);
      if (messageHighlights) messageHighlights.push(highlight);
      else byMessage.set(highlight.messageId, [highlight]);
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
        for (const highlight of messageHighlights) {
          const range = resolveAssistantCitationRange(source, highlight.selector);
          if (range === null) continue;
          const ranges = rangesByColor.get(highlight.color);
          if (ranges) ranges.push(range);
          else rangesByColor.set(highlight.color, [range]);
        }
      }
      for (const color of HIGHLIGHT_COLORS) {
        const ranges = rangesByColor.get(color.id);
        if (ranges === undefined || ranges.length === 0) {
          registry.delete(highlightRegistryName(color.id));
          continue;
        }
        registry.set(highlightRegistryName(color.id), new Highlight(...ranges));
      }
    };

    paint();
    let frame: number | null = null;
    const observer = new MutationObserver((records) => {
      if (!records.some(affectsSource)) return;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        paint();
      });
    });
    observer.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-assistant-citation-source"],
    });
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      clear();
    };
  }, [container, environmentId, highlights, threadId]);
}
