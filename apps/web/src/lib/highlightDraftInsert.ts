import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { formatAssistantCitationForComposer } from "../composer-logic";
import type { MarkdownFileHighlightExcerpt } from "../highlightStore";
import { formatMarkdownFileHighlightExcerpts } from "./highlightExcerpt";

export interface HighlightDraftContent {
  readonly citations: readonly AssistantCitation[];
  readonly excerpts: readonly MarkdownFileHighlightExcerpt[];
}

export function appendHighlightsToThreadDraft(
  target: ScopedThreadRef | DraftId,
  { citations, excerpts }: HighlightDraftContent,
): boolean {
  if (citations.length === 0 && excerpts.length === 0) return false;
  const drafts = useComposerDraftStore.getState();
  let prompt = drafts.getComposerDraft(target)?.prompt ?? "";
  if (citations.length > 0) {
    if (prompt && !/\s$/.test(prompt)) prompt += " ";
    prompt += citations.map((citation) => formatAssistantCitationForComposer(citation)).join("");
  }
  if (excerpts.length > 0) {
    if (prompt) prompt += "\n\n";
    prompt += formatMarkdownFileHighlightExcerpts(excerpts);
  }
  drafts.setPrompt(target, prompt);
  return true;
}

export function appendAssistantCitationsToThreadDraft(
  target: ScopedThreadRef | DraftId,
  citations: readonly AssistantCitation[],
): boolean {
  return appendHighlightsToThreadDraft(target, { citations, excerpts: [] });
}

export function appendMarkdownExcerptsToThreadDraft(
  target: ScopedThreadRef | DraftId,
  excerpts: readonly MarkdownFileHighlightExcerpt[],
): boolean {
  return appendHighlightsToThreadDraft(target, { citations: [], excerpts });
}
