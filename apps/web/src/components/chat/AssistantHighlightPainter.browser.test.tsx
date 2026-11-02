import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { useHighlightStore } from "~/highlightStore";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  highlightRegistryName,
} from "~/lib/highlightColors";
import { act, render } from "../../../test/render";
import { AssistantHighlightPainter } from "./AssistantHighlightPainter";

const threadRef: ScopedThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-1"),
);
const otherThreadRef: ScopedThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-2"),
);

function Harness({ ref = threadRef }: { ref?: ScopedThreadRef }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer}>
      <div
        data-assistant-citation-source={MessageId.make("message-1")}
        data-assistant-citation-environment={threadRef.environmentId}
        data-assistant-citation-thread={threadRef.threadId}
      >
        <p>alpha beta gamma</p>
      </div>
      <AssistantHighlightPainter container={container} threadRef={ref} />
    </div>
  );
}

function reset() {
  useHighlightStore.setState({ byThreadKey: {}, defaultColor: DEFAULT_HIGHLIGHT_COLOR });
  localStorage.clear();
  if (typeof CSS !== "undefined" && CSS.highlights) {
    for (const color of HIGHLIGHT_COLORS) CSS.highlights.delete(highlightRegistryName(color.id));
  }
}

function seed(ref = threadRef) {
  const result = useHighlightStore.getState().addHighlight(ref, {
    messageId: MessageId.make("message-1"),
    selector: { text: "beta", start: 6, end: 10, prefix: "alpha ", suffix: " gamma" },
  });
  if (!result.ok) throw new Error("Expected a highlight");
  return result.highlight.id;
}

describe("AssistantHighlightPainter", () => {
  it("paints a stored highlight and clears it when the entry is removed", async () => {
    reset();
    const id = seed();
    try {
      await using _screen = await render(<Harness />);

      await expect
        .poll(() => CSS.highlights.get(highlightRegistryName("amber"))?.size ?? 0)
        .toBe(1);

      await act(() => useHighlightStore.getState().removeHighlights(threadRef, [id]));

      await expect.poll(() => CSS.highlights.get(highlightRegistryName("amber"))).toBeUndefined();
    } finally {
      reset();
    }
  });

  it("does not paint highlights from another thread", async () => {
    reset();
    seed(otherThreadRef);
    try {
      await using _screen = await render(<Harness />);

      expect(CSS.highlights.get(highlightRegistryName("amber"))).toBeUndefined();
    } finally {
      reset();
    }
  });
});
