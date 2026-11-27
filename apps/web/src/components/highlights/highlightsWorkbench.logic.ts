import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ThreadHighlight } from "~/highlightStore";
import { markdownHighlightExcerpt, messageHighlightCitation } from "~/lib/highlightCitation";
import { HIGHLIGHT_COLORS, isHighlightColor, type HighlightColor } from "~/lib/highlightColors";
import type { HighlightDraftContent } from "~/lib/highlightDraftInsert";

const SCOPES = ["thread", "project", "all"] as const;
const GROUPS = ["source", "color"] as const;
const VIEWS = ["all", "noted", "unnoted"] as const;
const SOURCES = ["all", "messages", "files"] as const;
export const HIGHLIGHTS_QUERY_LIMIT = 200;

export interface HighlightsSearch {
  readonly scope?: (typeof SCOPES)[number];
  readonly group?: (typeof GROUPS)[number];
  readonly view?: (typeof VIEWS)[number];
  readonly source?: (typeof SOURCES)[number];
  readonly colors?: readonly HighlightColor[];
  readonly q?: string;
}

function pick<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" ? values.find((entry) => entry === value.trim()) : undefined;
}

export function validateHighlightsSearch(search: Record<string, unknown>): HighlightsSearch {
  const scope = pick(SCOPES, search.scope);
  const group = pick(GROUPS, search.group);
  const view = pick(VIEWS, search.view);
  const source = pick(SOURCES, search.source);
  const colors = Array.isArray(search.colors)
    ? [...new Set(search.colors.filter(isHighlightColor))]
    : [];
  const q = typeof search.q === "string" ? search.q.trim().slice(0, HIGHLIGHTS_QUERY_LIMIT) : "";
  return {
    ...(scope && { scope }),
    ...(group && group !== "source" && { group }),
    ...(view && view !== "all" && { view }),
    ...(source && source !== "all" && { source }),
    ...(colors.length > 0 && { colors }),
    ...(q && { q }),
  };
}

export type HighlightThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "title" | "archivedAt" | "hasPendingUserInput"
>;

export interface WorkbenchHighlight {
  readonly key: string;
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  readonly thread?: HighlightThread;
  readonly highlight: ThreadHighlight;
}

export function threadWorkbenchHighlights(
  threadRef: ScopedThreadRef,
  highlights: readonly ThreadHighlight[],
  thread?: HighlightThread,
): WorkbenchHighlight[] {
  const threadKey = scopedThreadKey(threadRef);
  return highlights.map((highlight) => ({
    key: JSON.stringify([threadKey, highlight.id]),
    threadRef,
    threadKey,
    ...(thread && { thread }),
    highlight,
  }));
}

export function collectWorkbenchHighlights(
  byThreadKey: Readonly<Record<string, readonly ThreadHighlight[]>>,
  threads: ReadonlyMap<string, HighlightThread>,
): WorkbenchHighlight[] {
  return Object.entries(byThreadKey).flatMap(([key, highlights]) => {
    const ref = parseScopedThreadKey(key);
    return ref ? threadWorkbenchHighlights(ref, highlights, threads.get(key)) : [];
  });
}

export function scopeWorkbenchHighlights(
  items: readonly WorkbenchHighlight[],
  scope: HighlightsSearch["scope"],
  threadKey: string | null,
  thread: HighlightThread | undefined,
): readonly WorkbenchHighlight[] {
  if (scope === "thread") return items.filter((item) => item.threadKey === threadKey);
  if (scope === "project" && thread) {
    return items.filter(
      (item) =>
        item.thread?.environmentId === thread.environmentId &&
        item.thread.projectId === thread.projectId,
    );
  }
  return items;
}

function searchPattern(query: string) {
  const text = query.trim();
  return text ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu") : null;
}

export function filterWorkbenchHighlights(
  items: readonly WorkbenchHighlight[],
  filters: HighlightsSearch,
  labels: { readonly assistant: string; readonly missingThread: string },
): WorkbenchHighlight[] {
  const pattern = searchPattern(filters.q ?? "");
  const colors = new Set(filters.colors);
  return items.filter(({ highlight: { color, notes, source, selector }, thread }) => {
    if (filters.view === "noted" && !notes?.length) return false;
    if (filters.view === "unnoted" && notes?.length) return false;
    if (filters.source === "messages" && source.kind !== "assistant-message") return false;
    if (filters.source === "files" && source.kind !== "markdown-file") return false;
    if (colors.size > 0 && !colors.has(color)) return false;
    if (!pattern) return true;
    return [
      selector.text,
      selector.prefix,
      selector.suffix,
      source.kind === "markdown-file" ? source.relativePath : labels.assistant,
      thread?.title ?? labels.missingThread,
      ...(notes?.map((note) => note.text) ?? []),
    ].some((text) => text.search(pattern) >= 0);
  });
}

export type WorkbenchGroup = {
  readonly key: string;
  readonly color?: HighlightColor;
  readonly items: WorkbenchHighlight[];
};

export function groupWorkbenchHighlights(
  items: readonly WorkbenchHighlight[],
  group: HighlightsSearch["group"],
): WorkbenchGroup[] {
  const groups = new Map<string, WorkbenchGroup>();
  const byColor = group === "color";
  const sorted = items.toSorted((a, b) =>
    a.highlight.createdAt.localeCompare(b.highlight.createdAt),
  );
  for (const item of sorted) {
    const { source, color } = item.highlight;
    const key = byColor
      ? color
      : JSON.stringify(
          source.kind === "assistant-message"
            ? [item.threadKey, source.kind, source.messageId]
            : [item.threadKey, source.kind, source.workspaceRoot, source.relativePath],
        );
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, ...(byColor && { color }), items: [item] });
  }
  if (byColor) return HIGHLIGHT_COLORS.flatMap(({ id }) => groups.get(id) ?? []);
  for (const group of groups.values()) {
    group.items.sort((a, b) => a.highlight.selector.start - b.highlight.selector.start);
  }
  return [...groups.values()];
}

export function splitHighlightSearchMatches(text: string, query: string) {
  const pattern = searchPattern(query);
  const segments: Array<{ text: string; match: boolean }> = [];
  let offset = 0;
  if (pattern) {
    for (const match of text.matchAll(pattern)) {
      if (match.index > offset)
        segments.push({ text: text.slice(offset, match.index), match: false });
      segments.push({ text: match[0], match: true });
      offset = match.index + match[0].length;
    }
  }
  if (offset < text.length) segments.push({ text: text.slice(offset), match: false });
  return segments;
}

export function workbenchDraftContent(
  items: readonly WorkbenchHighlight[],
  notes: (highlight: ThreadHighlight) => readonly (string | undefined)[],
): HighlightDraftContent {
  const citations: HighlightDraftContent["citations"][number][] = [];
  const excerpts: HighlightDraftContent["excerpts"][number][] = [];
  for (const { threadRef, highlight } of items) {
    for (const comment of notes(highlight)) {
      const citation = messageHighlightCitation(threadRef, highlight, comment);
      if (citation) citations.push(citation);
      else {
        const excerpt = markdownHighlightExcerpt(highlight, comment);
        if (excerpt) excerpts.push(excerpt);
      }
    }
  }
  return { citations, excerpts };
}
