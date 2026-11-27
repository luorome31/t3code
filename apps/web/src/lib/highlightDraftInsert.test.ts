import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
  type AssistantCitation,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { useComposerDraftStore, queuedRunEditDraftId } from "../composerDraftStore";
import { formatAssistantCitationForComposer } from "../composer-logic";
import {
  appendAssistantCitationsToThreadDraft,
  appendHighlightsToThreadDraft,
  appendMarkdownExcerptsToThreadDraft,
} from "./highlightDraftInsert";
import { formatMarkdownFileHighlightExcerpts } from "./highlightExcerpt";

const ref = scopeThreadRef(EnvironmentId.make("draft-env"), ThreadId.make("draft-thread"));
const citation: AssistantCitation = {
  ...ref,
  version: 1,
  messageId: MessageId.make("message"),
  text: "passage",
  start: 0,
  end: 7,
  prefix: "",
  suffix: "",
  comment: "follow up",
};
const excerpts = [{ workspaceRoot: "/repo", relativePath: "guide.md", text: "another passage" }];

it.each([
  ["", ""],
  ["existing", " "],
  ["existing\t", ""],
])("appends citations with one whitespace boundary to %j", (initial, boundary) => {
  const drafts = useComposerDraftStore.getState();
  drafts.setPrompt(ref, initial);
  expect(appendAssistantCitationsToThreadDraft(ref, [citation])).toBe(true);
  expect(drafts.getComposerDraft(ref)?.prompt).toBe(
    `${initial}${boundary}${formatAssistantCitationForComposer(citation)}`,
  );
});

it("combines source types in the base draft without touching the queued message edit", () => {
  const drafts = useComposerDraftStore.getState();
  const edit = queuedRunEditDraftId(ref, RunId.make("run"));
  drafts.setPrompt(ref, "Existing");
  drafts.setPrompt(edit, "Queued edit");
  expect(appendHighlightsToThreadDraft(ref, { citations: [citation], excerpts })).toBe(true);
  expect(drafts.getComposerDraft(ref)?.prompt).toBe(
    `Existing ${formatAssistantCitationForComposer(citation)}\n\n${formatMarkdownFileHighlightExcerpts(excerpts)}`,
  );
  expect(appendMarkdownExcerptsToThreadDraft(ref, [])).toBe(false);
  expect(drafts.getComposerDraft(edit)?.prompt).toBe("Queued edit");
});
