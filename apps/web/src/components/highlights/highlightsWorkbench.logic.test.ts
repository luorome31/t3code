import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import type { ThreadHighlight } from "~/highlightStore";
import {
  collectWorkbenchHighlights,
  filterWorkbenchHighlights,
  groupWorkbenchHighlights,
  scopeWorkbenchHighlights,
  splitHighlightSearchMatches,
  validateHighlightsSearch,
  type HighlightThread,
} from "./highlightsWorkbench.logic";

const ref = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread"));
const offline = scopeThreadRef(EnvironmentId.make("offline"), ref.threadId);
const thread = {
  environmentId: ref.environmentId,
  id: ref.threadId,
  projectId: ProjectId.make("project"),
  title: "Routing details",
  archivedAt: null,
  hasPendingUserInput: false,
} satisfies HighlightThread;
const key = scopedThreadKey(ref);
const message: ThreadHighlight = {
  id: "message",
  source: { kind: "assistant-message", messageId: MessageId.make("reply") },
  selector: { text: "Code excerpt", prefix: "Before ", suffix: " After", start: 7, end: 19 },
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  notes: [{ id: "note", text: "Literal <tag>" }],
};
const file: ThreadHighlight = {
  ...message,
  id: "file",
  source: { kind: "markdown-file", workspaceRoot: "/repo", relativePath: "guide/setup.md" },
  color: "amber",
  notes: [],
};
const labels = { assistant: "Assistant message", missingThread: "Archived or offline thread" };

it("keeps offline highlights, scopes by environment and project, and intersects filters", () => {
  const items = collectWorkbenchHighlights(
    { [key]: [message, file], [scopedThreadKey(offline)]: [message], invalid: [file] },
    new Map([[key, thread]]),
  );
  expect(items).toHaveLength(3);
  expect(new Set(items.map(({ key }) => key)).size).toBe(3);
  expect(items[2]?.thread).toBeUndefined();
  const project = scopeWorkbenchHighlights(items, "project", key, thread);
  expect(project).toHaveLength(2);
  expect(scopeWorkbenchHighlights(items, "thread", scopedThreadKey(offline), undefined)).toEqual([
    items[2],
  ]);
  for (const q of ["code", "BEFORE", "after", "routing", "<TAG>", "assistant"]) {
    expect(
      filterWorkbenchHighlights(
        project,
        { q, colors: ["blue", "purple"], source: "messages", view: "noted" },
        labels,
      ),
    ).toEqual([items[0]]);
  }
  expect(
    filterWorkbenchHighlights(project, { q: "setup.md", source: "files", view: "unnoted" }, labels),
  ).toEqual([items[1]]);
  expect(filterWorkbenchHighlights(project, { colors: ["amber"], view: "noted" }, labels)).toEqual(
    [],
  );
  expect(filterWorkbenchHighlights(items, { q: "offline" }, labels)).toEqual([items[2]]);
});

it("groups interleaved passages by scoped source, orders passages by offset and colors by palette", () => {
  const earlier = { ...message, id: "earlier", selector: { ...message.selector, start: 0 } };
  const items = collectWorkbenchHighlights(
    { [key]: [message, file, earlier], [scopedThreadKey(offline)]: [message] },
    new Map(),
  );
  expect(
    groupWorkbenchHighlights(items, "source").map(({ items }) =>
      items.map(({ highlight }) => highlight.id),
    ),
  ).toEqual([["earlier", "message"], ["file"], ["message"]]);
  expect(groupWorkbenchHighlights(items, "color").map(({ color }) => color)).toEqual([
    "amber",
    "blue",
  ]);
});

it("sanitizes search params and splits repeated literal matches without interpreting markup", () => {
  expect(
    validateHighlightsSearch({
      scope: " project ",
      group: "bad",
      view: ["noted"],
      source: " files ",
      colors: ["blue", "blue", null, "red", "invalid"],
      q: ` ${"x".repeat(240)} `,
    }),
  ).toEqual({ scope: "project", source: "files", colors: ["blue", "red"], q: "x".repeat(200) });
  expect(splitHighlightSearchMatches("<b> a+b A+B", " a+b ")).toEqual([
    { text: "<b> ", match: false },
    { text: "a+b", match: true },
    { text: " ", match: false },
    { text: "A+B", match: true },
  ]);
});
