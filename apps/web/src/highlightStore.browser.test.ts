import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { HIGHLIGHT_STORAGE_KEY, useHighlightStore, type ThreadHighlight } from "./highlightStore";
import { DEFAULT_HIGHLIGHT_COLOR } from "./lib/highlightColors";

const threadKey = `${EnvironmentId.make("environment-1")}:${ThreadId.make("thread-1")}`;

const validHighlight: ThreadHighlight = {
  id: "highlight-1",
  messageId: MessageId.make("message-1"),
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
          version: 1,
        }),
      );

      await useHighlightStore.persist.rehydrate();

      const state = useHighlightStore.getState();
      expect(state.byThreadKey[threadKey]).toHaveLength(1);
      expect(state.byThreadKey[threadKey]?.[0]?.id).toBe("highlight-1");
      expect(state.defaultColor).toBe(DEFAULT_HIGHLIGHT_COLOR);
    } finally {
      resetStore();
    }
  });
});
