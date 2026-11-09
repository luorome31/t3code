import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import type { ThreadHighlight } from "~/highlightStore";
import { resolveAssistantCitationRanges } from "~/lib/assistantTextSelection";
import type { HighlightColor } from "~/lib/highlightColors";
import {
  registerHighlightContribution,
  removeHighlightContribution,
} from "~/lib/highlightPainting";

function fileHighlightsOf(
  highlights: readonly ThreadHighlight[],
  workspaceRoot: string,
  relativePath: string,
): ThreadHighlight[] {
  return highlights.filter(
    (highlight) =>
      highlight.source.kind === "markdown-file" &&
      highlight.source.workspaceRoot === workspaceRoot &&
      highlight.source.relativePath === relativePath,
  );
}

export function useMarkdownFileHighlights(input: {
  readonly container: HTMLElement | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly highlights: readonly ThreadHighlight[];
}): void {
  const { container, threadRef, workspaceRoot, relativePath, highlights } = input;
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const [owner] = useState<object>(() => ({}));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the shared CSS highlight registry in step with the rendered Markdown file and releases this pane's contribution on unmount
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
    const fileHighlights = fileHighlightsOf(highlights, workspaceRoot, relativePath);
    if (fileHighlights.length === 0) {
      removeHighlightContribution(owner);
      return;
    }

    const priorityByColor = new Map<HighlightColor, number>();
    for (const highlight of fileHighlights) {
      const createdAt = Date.parse(highlight.createdAt);
      const priority = 1 + (Number.isFinite(createdAt) ? createdAt / 1e13 : 0);
      priorityByColor.set(
        highlight.color,
        Math.max(priorityByColor.get(highlight.color) ?? 0, priority),
      );
    }

    const paint = () => {
      const ranges = resolveAssistantCitationRanges(
        container,
        fileHighlights.map((highlight) => highlight.selector),
      );
      const rangesByColor = new Map<HighlightColor, Range[]>();
      for (let index = 0; index < ranges.length; index += 1) {
        const range = ranges[index];
        if (range === null || range === undefined) continue;
        const color = fileHighlights[index]!.color;
        const colorRanges = rangesByColor.get(color);
        if (colorRanges) colorRanges.push(range);
        else rangesByColor.set(color, [range]);
      }
      registerHighlightContribution(owner, { rangesByColor, priorityByColor });
    };

    paint();
    const observer = new MutationObserver(paint);
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      removeHighlightContribution(owner);
    };
  }, [container, environmentId, highlights, owner, relativePath, threadId, workspaceRoot]);
}
