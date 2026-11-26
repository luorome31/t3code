import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";

import type { MarkdownFileHighlightExcerpt, ThreadHighlight } from "~/highlightStore";

export function messageHighlightCitation(
  threadRef: ScopedThreadRef,
  highlight: ThreadHighlight,
  comment?: string,
): AssistantCitation | null {
  if (highlight.source.kind !== "assistant-message") return null;
  return {
    version: 1,
    ...threadRef,
    messageId: highlight.source.messageId,
    ...highlight.selector,
    ...(comment !== undefined ? { comment } : {}),
  };
}

export function markdownHighlightExcerpt(
  highlight: ThreadHighlight,
  comment?: string,
): MarkdownFileHighlightExcerpt | null {
  if (highlight.source.kind !== "markdown-file") return null;
  return {
    workspaceRoot: highlight.source.workspaceRoot,
    relativePath: highlight.source.relativePath,
    text: highlight.selector.text,
    ...(comment !== undefined ? { comment } : {}),
  };
}

export type HighlightInsert<T> = (content: T, destination?: "chat-draft") => boolean;
