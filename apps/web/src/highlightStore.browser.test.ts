import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_HIGHLIGHT_COLOR_MODE,
  HIGHLIGHT_COLOR_MODE_STORAGE_KEY,
  HIGHLIGHT_COLOR_STORAGE_KEY,
  HIGHLIGHT_STORAGE_KEY,
  rehydrateHighlights,
  useHighlightStore,
  type ThreadHighlight,
} from "./highlightStore";
import { DEFAULT_HIGHLIGHT_COLOR } from "./lib/highlightColors";

const legacyKey = "t3code:thread-highlights:v1";
const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const threadKey = `${EnvironmentId.make("environment-1")}:${ThreadId.make("thread-1")}`;

const validHighlight: ThreadHighlight = {
  id: "highlight-1",
  source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
  selector: { text: "quote", start: 0, end: 5, prefix: "", suffix: "" },
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function resetStore() {
  useHighlightStore.setState({
    byThreadKey: {},
    defaultColor: DEFAULT_HIGHLIGHT_COLOR,
    colorMode: DEFAULT_HIGHLIGHT_COLOR_MODE,
    existingPaletteExpanded: false,
    threadDefaultColors: {},
  });
  localStorage.clear();
}

describe("highlightStore persistence", () => {
  it("rehydrates valid highlights and drops malformed entries", () => {
    resetStore();
    try {
      localStorage.setItem(
        legacyKey,
        JSON.stringify({
          state: {
            byThreadKey: {
              [threadKey]: [
                validHighlight,
                {
                  ...validHighlight,
                  id: "highlight-2",
                  selector: { ...validHighlight.selector, start: -1 },
                },
              ],
            },
            defaultColor: "not-a-color",
          },
          version: 2,
        }),
      );
      localStorage.setItem(HIGHLIGHT_COLOR_STORAGE_KEY, "blue");

      rehydrateHighlights();

      const state = useHighlightStore.getState();
      expect(state.byThreadKey[threadKey]).toHaveLength(1);
      expect(state.byThreadKey[threadKey]?.[0]?.id).toBe("highlight-1");
      expect(state.defaultColor).toBe("blue");
    } finally {
      resetStore();
    }
  });

  it("migrates version 1 message highlights to the source model", () => {
    resetStore();
    try {
      localStorage.setItem(
        legacyKey,
        JSON.stringify({
          state: {
            byThreadKey: {
              [threadKey]: [
                {
                  id: "legacy-highlight",
                  messageId: "message-legacy",
                  selector: { text: "quote", start: 0, end: 5, prefix: "", suffix: "" },
                  color: "green",
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          },
          version: 1,
        }),
      );

      rehydrateHighlights();

      expect(useHighlightStore.getState().byThreadKey[threadKey]?.[0]?.source).toEqual({
        kind: "assistant-message",
        messageId: MessageId.make("message-legacy"),
      });
    } finally {
      resetStore();
    }
  });

  it("persists highlight preferences separately from the highlight blob", () => {
    resetStore();
    try {
      expect(useHighlightStore.getState().addHighlight(threadRef, validHighlight).ok).toBe(true);
      const before = localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
      expect(before).not.toBeNull();

      expect(useHighlightStore.getState().existingPaletteExpanded).toBe(false);
      useHighlightStore.getState().setDefaultColor("green");
      useHighlightStore.getState().setExistingPaletteExpanded(true);
      expect(useHighlightStore.getState().existingPaletteExpanded).toBe(true);

      useHighlightStore.setState({ existingPaletteExpanded: false });
      rehydrateHighlights();
      expect(useHighlightStore.getState().existingPaletteExpanded).toBe(true);

      useHighlightStore.getState().setExistingPaletteExpanded(false);
      useHighlightStore.setState({ existingPaletteExpanded: true });
      rehydrateHighlights();
      expect(useHighlightStore.getState().existingPaletteExpanded).toBe(false);
      expect(localStorage.getItem(HIGHLIGHT_STORAGE_KEY)).toBe(before);
      expect(localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEY)).toBe("green");
      expect(JSON.parse(before ?? "{}").state.defaultColor).toBeUndefined();
    } finally {
      resetStore();
    }
  });

  it("rehydrates thread default colors and drops invalid ones", () => {
    resetStore();
    try {
      localStorage.setItem(
        legacyKey,
        JSON.stringify({
          state: {
            byThreadKey: { [threadKey]: [validHighlight] },
            threadDefaultColors: {
              [threadKey]: "purple",
              [`${EnvironmentId.make("environment-1")}:${ThreadId.make("thread-2")}`]:
                "not-a-color",
            },
          },
          version: 3,
        }),
      );
      localStorage.setItem(HIGHLIGHT_COLOR_MODE_STORAGE_KEY, "selection");

      rehydrateHighlights();

      const state = useHighlightStore.getState();
      expect(state.threadDefaultColors[threadKey]).toBe("purple");
      expect(Object.keys(state.threadDefaultColors)).toHaveLength(1);
      expect(state.colorMode).toBe("selection");
    } finally {
      resetStore();
    }
  });

  it.each([3, 4])("imports notes from legacy version %s and survives a downgrade", (version) => {
    resetStore();
    try {
      localStorage.setItem(
        legacyKey,
        JSON.stringify({
          state: {
            byThreadKey: {
              [threadKey]: [
                { ...validHighlight, note: "why this matters" },
                { ...validHighlight, id: "highlight-2", note: "x".repeat(2001) },
                {
                  ...validHighlight,
                  id: "highlight-3",
                  notes: [
                    { id: "note-1", text: "one" },
                    { id: "note-2", text: "two" },
                    { id: "note-2", text: "duplicate" },
                    { id: "note-3", text: "   " },
                  ],
                },
              ],
            },
          },
          version,
        }),
      );

      rehydrateHighlights();

      const highlights = useHighlightStore.getState().byThreadKey[threadKey] ?? [];
      expect(highlights.map((highlight) => highlight.notes)).toEqual([
        [{ id: "highlight-1", text: "why this matters" }],
        undefined,
        [
          { id: "note-1", text: "one" },
          { id: "note-2", text: "two" },
        ],
      ]);
      localStorage.setItem(
        legacyKey,
        JSON.stringify({ state: { byThreadKey: { [threadKey]: [validHighlight] } }, version: 3 }),
      );
      rehydrateHighlights();
      expect(useHighlightStore.getState().byThreadKey[threadKey]).toEqual(highlights);
    } finally {
      resetStore();
    }
  });

  it("leaves the saved notes unchanged when storage rejects a save or deletion", () => {
    resetStore();
    try {
      const highlight = { ...validHighlight, notes: [{ id: "note-1", text: "saved note" }] };
      localStorage.setItem(
        HIGHLIGHT_STORAGE_KEY,
        JSON.stringify({ state: { byThreadKey: { [threadKey]: [highlight] } }, version: 4 }),
      );
      rehydrateHighlights();
      const before = localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
      using _write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Storage is full", "QuotaExceededError");
      });
      const store = useHighlightStore.getState();
      expect(store.saveHighlightNote(threadRef, highlight.id, "unsaved note", "note-1")).toBe(
        false,
      );
      expect(store.removeHighlightNote(threadRef, highlight.id, "note-1")).toBe(false);
      expect(useHighlightStore.getState().byThreadKey[threadKey]).toEqual([highlight]);
      expect(localStorage.getItem(HIGHLIGHT_STORAGE_KEY)).toBe(before);
    } finally {
      resetStore();
    }
  });
});
