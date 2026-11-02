import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  MAX_HIGHLIGHTS_PER_THREAD,
  MAX_HIGHLIGHT_TEXT_LENGTH,
  useHighlightStore,
} from "./highlightStore";
import type { AssistantTextSelector } from "./lib/assistantTextSelection";
import { DEFAULT_HIGHLIGHT_COLOR } from "./lib/highlightColors";

const threadRef = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const otherThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-2"),
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
    messageId: MessageId.make("message-1"),
    selector: selector(text, start),
  });
}

beforeEach(() => {
  useHighlightStore.setState({ byThreadKey: {}, defaultColor: DEFAULT_HIGHLIGHT_COLOR });
  if (typeof localStorage !== "undefined") localStorage.clear();
});

describe("highlightStore", () => {
  it("adds a highlight with the current default color", () => {
    const result = add();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.highlight.color).toBe(DEFAULT_HIGHLIGHT_COLOR);
    expect(result.highlight.messageId).toBe(MessageId.make("message-1"));
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toHaveLength(1);
  });

  it("rejects a duplicate selector on the same message", () => {
    expect(add().ok).toBe(true);

    expect(add()).toEqual({ ok: false, reason: "duplicate" });
  });

  it("keeps the same selector on another message", () => {
    expect(add().ok).toBe(true);

    const result = useHighlightStore.getState().addHighlight(threadRef, {
      messageId: MessageId.make("message-2"),
      selector: selector(),
    });

    expect(result.ok).toBe(true);
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

  it("isolates highlights by thread", () => {
    expect(add().ok).toBe(true);
    const other = useHighlightStore.getState().addHighlight(otherThreadRef, {
      messageId: MessageId.make("message-1"),
      selector: selector(),
    });

    expect(other.ok).toBe(true);
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toHaveLength(1);
    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-2"]).toHaveLength(1);
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

  it("prunes thread keys that no longer exist", () => {
    expect(add().ok).toBe(true);
    useHighlightStore.getState().pruneThreads(new Set(["environment-1:thread-2"]));

    expect(useHighlightStore.getState().byThreadKey["environment-1:thread-1"]).toBeUndefined();
  });
});
