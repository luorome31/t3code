import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  HIGHLIGHT_COLOR_STORAGE_KEY,
  HIGHLIGHT_STORAGE_KEY,
  useHighlightStore,
  type ThreadHighlight,
} from "./highlightStore";
import { DEFAULT_HIGHLIGHT_COLOR } from "./lib/highlightColors";

const threadKey = `${EnvironmentId.make("environment-1")}:${ThreadId.make("thread-1")}`;

const validHighlight: ThreadHighlight = {
  id: "highlight-1",
  source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
  selector: { text: "quote", start: 0, end: 5, prefix: "", suffix: "" },
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function resetStore() {
  useHighlightStore.setState({ byThreadKey: {}, defaultColor: DEFAULT_HIGHLIGHT_COLOR });
  localStorage.clear();
}

describe("highlightStore persistence", () => {
  it("rehydrates valid highlights and drops malformed entries", async () => {
    resetStore();
    try {
      localStorage.setItem(
        HIGHLIGHT_STORAGE_KEY,
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

      await useHighlightStore.persist.rehydrate();

      const state = useHighlightStore.getState();
      expect(state.byThreadKey[threadKey]).toHaveLength(1);
      expect(state.byThreadKey[threadKey]?.[0]?.id).toBe("highlight-1");
      expect(state.defaultColor).toBe("blue");
    } finally {
      resetStore();
    }
  });

  it("migrates version 1 message highlights to the source model", async () => {
    resetStore();
    try {
      localStorage.setItem(
        HIGHLIGHT_STORAGE_KEY,
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

      await useHighlightStore.persist.rehydrate();

      expect(useHighlightStore.getState().byThreadKey[threadKey]?.[0]?.source).toEqual({
        kind: "assistant-message",
        messageId: MessageId.make("message-legacy"),
      });
    } finally {
      resetStore();
    }
  });

  it("does not rewrite the highlight blob when the default color changes", () => {
    resetStore();
    try {
      useHighlightStore.setState({
        byThreadKey: { [threadKey]: [validHighlight] },
        defaultColor: DEFAULT_HIGHLIGHT_COLOR,
      });
      const before = localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
      expect(before).not.toBeNull();

      useHighlightStore.getState().setDefaultColor("green");

      expect(localStorage.getItem(HIGHLIGHT_STORAGE_KEY)).toBe(before);
      expect(localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEY)).toBe("green");
      expect(JSON.parse(before ?? "{}").state.defaultColor).toBeUndefined();
    } finally {
      resetStore();
    }
  });
});
