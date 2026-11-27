import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_HIGHLIGHT_COLOR_MODE,
  HIGHLIGHT_COLOR_MODE_STORAGE_KEY,
  MAX_HIGHLIGHTS_PER_THREAD,
  MAX_HIGHLIGHT_NOTE_LENGTH,
  MAX_HIGHLIGHT_TEXT_LENGTH,
  useHighlightStore,
  readThreadHighlights,
} from "./highlightStore";
import type { AssistantTextSelector } from "./lib/assistantTextSelection";
import { DEFAULT_HIGHLIGHT_COLOR } from "./lib/highlightColors";

const threadRef = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const otherThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-2"),
);
const otherEnvironmentThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-2"),
  ThreadId.make("thread-1"),
);

function selector(text = "highlight me", start = 0): AssistantTextSelector {
  return {
    text,
    start,
    end: start + text.length,
    prefix: "",
    suffix: "",
  };
}

function add(text = "highlight me", start = 0) {
  return useHighlightStore.getState().addHighlight(threadRef, {
    source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
    selector: selector(text, start),
  });
}

beforeEach(() => {
  useHighlightStore.setState({
    byThreadKey: {},
    defaultColor: DEFAULT_HIGHLIGHT_COLOR,
    colorMode: DEFAULT_HIGHLIGHT_COLOR_MODE,
    threadDefaultColors: {},
  });
  if (typeof localStorage !== "undefined") localStorage.clear();
});

describe("highlightStore", () => {
  it("adds a highlight with the current default color", () => {
    const result = add();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.highlight.color).toBe(DEFAULT_HIGHLIGHT_COLOR);
    expect(result.highlight.source).toEqual({
      kind: "assistant-message",
      messageId: MessageId.make("message-1"),
    });
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toHaveLength(1);
  });

  it("recolors multiple highlights and restores deleted highlights and notes in place", () => {
    for (const [index, text] of ["one", "two", "three"].entries())
      expect(add(text, index * 10).ok).toBe(true);
    const store = useHighlightStore.getState();
    const [first, , third] = readThreadHighlights(threadRef);
    store.recolorHighlights(threadRef, [first!.id, third!.id], "red");
    expect(readThreadHighlights(threadRef).map(({ color }) => color)).toEqual([
      "red",
      DEFAULT_HIGHLIGHT_COLOR,
      "red",
    ]);
    store.saveHighlightNote(threadRef, first!.id, "first note");
    store.saveHighlightNote(threadRef, first!.id, "second note");
    const before = readThreadHighlights(threadRef);
    const note = before[0]!.notes![0]!;
    expect(store.removeHighlightNote(threadRef, first!.id, note.id)).toBe(true);
    expect(store.restoreHighlightNote(threadRef, first!.id, note, 0)).toBe(true);
    expect(store.restoreHighlightNote(threadRef, first!.id, note, 0)).toBe(false);
    expect(store.removeHighlights(threadRef, [first!.id, third!.id])).toBe(true);
    const deleted = [
      { highlight: before[2]!, index: 2 },
      { highlight: before[0]!, index: 0 },
    ];
    expect(store.restoreHighlights(threadRef, deleted)).toBe(true);
    expect(store.restoreHighlights(threadRef, deleted)).toBe(false);
    expect(readThreadHighlights(threadRef)).toEqual(before);
  });

  it("rejects a duplicate selector on the same message", () => {
    expect(add().ok).toBe(true);

    expect(add()).toEqual({ ok: false, reason: "duplicate" });
  });

  it("keeps the same selector on another message", () => {
    expect(add().ok).toBe(true);

    const result = useHighlightStore.getState().addHighlight(threadRef, {
      source: { kind: "assistant-message", messageId: MessageId.make("message-2") },
      selector: selector(),
    });

    expect(result.ok).toBe(true);
  });

  it("scopes Markdown file highlights to their workspace file", () => {
    const source = {
      kind: "markdown-file" as const,
      workspaceRoot: "/repo",
      relativePath: "docs/design.md",
    };
    expect(
      useHighlightStore.getState().addHighlight(threadRef, { source, selector: selector() }).ok,
    ).toBe(true);
    expect(
      useHighlightStore.getState().addHighlight(threadRef, { source, selector: selector() }),
    ).toEqual({ ok: false, reason: "duplicate" });
    expect(
      useHighlightStore.getState().addHighlight(threadRef, {
        source: { ...source, relativePath: "docs/other.md" },
        selector: selector(),
      }).ok,
    ).toBe(true);
    expect(
      useHighlightStore.getState().addHighlight(threadRef, {
        source: { ...source, workspaceRoot: "/other" },
        selector: selector(),
      }).ok,
    ).toBe(true);
  });

  it("accepts a selection exactly at the text limit", () => {
    expect(add("x".repeat(MAX_HIGHLIGHT_TEXT_LENGTH)).ok).toBe(true);
  });

  it("rejects a selection longer than the text limit", () => {
    const result = add("x".repeat(MAX_HIGHLIGHT_TEXT_LENGTH + 1));

    expect(result).toEqual({ ok: false, reason: "too_long" });
  });

  it("removes selected highlights and drops an empty thread entry", () => {
    const first = add();
    const second = add("another highlight", 20);
    if (!first.ok || !second.ok) throw new Error("expected highlights");

    useHighlightStore.getState().removeHighlights(threadRef, [first.highlight.id]);
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toHaveLength(1);

    useHighlightStore.getState().removeHighlights(threadRef, [second.highlight.id]);
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toBeUndefined();
  });

  it("recolors one highlight without touching the others", () => {
    const first = add();
    const second = add("another highlight", 20);
    if (!first.ok || !second.ok) throw new Error("expected highlights");

    useHighlightStore.getState().recolorHighlight(threadRef, first.highlight.id, "blue");

    const highlights = useHighlightStore.getState().byThreadKey["environment-1:thread-1"] ?? [];
    expect(highlights.find((highlight) => highlight.id === first.highlight.id)?.color).toBe("blue");
    expect(highlights.find((highlight) => highlight.id === second.highlight.id)?.color).toBe(
      DEFAULT_HIGHLIGHT_COLOR,
    );
  });

  it("applies a new default color only to new highlights", () => {
    const first = add();
    useHighlightStore.getState().setDefaultColor("green");
    const second = add("later highlight", 30);
    if (!first.ok || !second.ok) throw new Error("expected highlights");

    expect(first.highlight.color).toBe(DEFAULT_HIGHLIGHT_COLOR);
    expect(second.highlight.color).toBe("green");
  });

  it("prefers the thread's default color over the global default", () => {
    useHighlightStore.getState().setDefaultColor("green");
    useHighlightStore.getState().setThreadDefaultColor(threadRef, "purple");

    const highlighted = add();
    const other = useHighlightStore.getState().addHighlight(otherThreadRef, {
      source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
      selector: selector(),
    });

    expect(highlighted.ok && highlighted.highlight.color).toBe("purple");
    expect(other.ok && other.highlight.color).toBe("green");
    expect(useHighlightStore.getState().threadDefaultColors["environment-1:thread-1"]).toBe(
      "purple",
    );
  });

  it("applies an explicit color over every default", () => {
    useHighlightStore.getState().setThreadDefaultColor(threadRef, "purple");

    const result = useHighlightStore.getState().addHighlight(threadRef, {
      source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
      selector: selector(),
      color: "blue",
    });

    expect(result.ok && result.highlight.color).toBe("blue");
  });

  it("adds, edits, and removes individual notes without changing their siblings", () => {
    const first = add();
    if (!first.ok) throw new Error("expected a highlight");
    const id = first.highlight.id;
    const { saveHighlightNote, removeHighlightNote } = useHighlightStore.getState();
    const firstNoteId = saveHighlightNote(threadRef, id, " why this ");
    const secondNoteId = saveHighlightNote(threadRef, id, "Follow up separately");
    const notes = () =>
      useHighlightStore.getState().byThreadKey["environment-1:thread-1"]?.[0]?.notes;
    const [one, two] = notes() ?? [];
    if (!one || !two) throw new Error("expected two notes");
    expect(one).toEqual({ id: firstNoteId, text: "why this" });
    expect(two.id).toBe(secondNoteId);

    expect(saveHighlightNote(threadRef, id, "updated", one.id)).toBe(one.id);
    expect(saveHighlightNote(threadRef, id, "updated", one.id)).toBe(one.id);
    expect(notes()).toEqual([{ ...one, text: "updated" }, two]);
    removeHighlightNote(threadRef, id, one.id);
    expect(notes()).toEqual([two]);
    expect(saveHighlightNote(threadRef, id, "stale edit", one.id)).toBe(false);
    removeHighlightNote(threadRef, id, two.id);
    expect(notes()).toBeUndefined();
  });

  it("rejects an empty or oversized note, or a missing highlight", () => {
    const first = add();
    if (!first.ok) throw new Error("expected a highlight");
    const { saveHighlightNote } = useHighlightStore.getState();
    expect(saveHighlightNote(threadRef, first.highlight.id, "   ")).toBe(false);
    expect(
      saveHighlightNote(threadRef, first.highlight.id, "x".repeat(MAX_HIGHLIGHT_NOTE_LENGTH + 1)),
    ).toBe(false);
    expect(saveHighlightNote(threadRef, "missing", "text")).toBe(false);
    expect(
      useHighlightStore.getState().byThreadKey["environment-1:thread-1"]?.[0]?.notes,
    ).toBeUndefined();
  });

  it("sets the color mode and persists it for the next session", () => {
    useHighlightStore.getState().setColorMode("selection");

    expect(useHighlightStore.getState().colorMode).toBe("selection");
    if (typeof localStorage === "undefined") return;
    expect(localStorage.getItem(HIGHLIGHT_COLOR_MODE_STORAGE_KEY)).toBe("selection");
  });

  it("isolates highlights by thread", () => {
    expect(add().ok).toBe(true);
    const other = useHighlightStore.getState().addHighlight(otherThreadRef, {
      source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
      selector: selector(),
    });

    expect(other.ok).toBe(true);
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toHaveLength(1);
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-2"]).toHaveLength(1);
  });

  it("isolates the same thread id in another environment", () => {
    expect(add().ok).toBe(true);
    const other = useHighlightStore.getState().addHighlight(otherEnvironmentThreadRef, {
      source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
      selector: selector(),
    });

    expect(other.ok).toBe(true);
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toHaveLength(1);
    expect(useHighlightStore.getState().byThreadKey["environment-2:thread-1"]).toHaveLength(1);
  });

  it("stops at the per-thread limit", () => {
    for (let index = 0; index < MAX_HIGHLIGHTS_PER_THREAD; index += 1) {
      const result = add("highlight", index * 10);
      expect(result.ok).toBe(true);
    }

    expect(add("highlight", MAX_HIGHLIGHTS_PER_THREAD * 10)).toEqual({
      ok: false,
      reason: "limit",
    });
  });

  it("clears one thread without touching another", () => {
    expect(add().ok).toBe(true);
    useHighlightStore.getState().addHighlight(otherThreadRef, {
      source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
      selector: selector(),
    });
    useHighlightStore.getState().setThreadDefaultColor(threadRef, "purple");
    useHighlightStore.getState().setThreadDefaultColor(otherThreadRef, "blue");

    useHighlightStore.getState().clearThread(threadRef);

    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toBeUndefined();
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-2"]).toHaveLength(1);
    expect(
      useHighlightStore.getState().threadDefaultColors["environment-1:thread-1"],
    ).toBeUndefined();
    expect(useHighlightStore.getState().threadDefaultColors["environment-1:thread-2"]).toBe("blue");
  });
});
