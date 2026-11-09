import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { useHighlightStore, type ThreadHighlight } from "~/highlightStore";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  highlightRegistryName,
  type HighlightColor,
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

function Harness({
  text = "alpha beta gamma",
  sourceThread = threadRef,
  extraPainter = false,
}: {
  text?: string;
  sourceThread?: ScopedThreadRef;
  extraPainter?: boolean;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer}>
      <div
        data-assistant-citation-source={MessageId.make("message-1")}
        data-assistant-citation-environment={sourceThread.environmentId}
        data-assistant-citation-thread={sourceThread.threadId}
      >
        <p>{text}</p>
      </div>
      <AssistantHighlightPainter container={container} threadRef={threadRef} />
      {extraPainter ? (
        <AssistantHighlightPainter container={container} threadRef={otherThreadRef} />
      ) : null}
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

function highlight(
  id: string,
  color: HighlightColor,
  text: string,
  start: number,
  prefix: string,
  suffix: string,
  createdAt: string,
): ThreadHighlight {
  return {
    id,
    source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
    selector: { text, start, end: start + text.length, prefix, suffix },
    color,
    createdAt,
  };
}

function seed(entries: ThreadHighlight[]) {
  useHighlightStore.setState({
    byThreadKey: { [scopedThreadKey(threadRef)]: entries },
    defaultColor: DEFAULT_HIGHLIGHT_COLOR,
  });
}

function rangeText(color: HighlightColor): string | undefined {
  const registry = CSS.highlights.get(highlightRegistryName(color));
  return registry ? Array.from(registry)[0]?.toString() : undefined;
}

function highlightOrder(): string[] {
  return [...CSS.highlights.keys()].filter((name) => name.startsWith("t3-assistant-highlight-"));
}

describe("AssistantHighlightPainter", () => {
  it("paints a stored highlight and clears it when the entry is removed", async () => {
    reset();
    seed([
      highlight("highlight-1", "amber", "beta", 6, "alpha ", " gamma", "2026-01-01T00:00:00Z"),
    ]);
    try {
      await using _screen = await render(<Harness />);

      await expect.poll(() => rangeText("amber")).toBe("beta");

      await act(() => useHighlightStore.getState().removeHighlights(threadRef, ["highlight-1"]));

      await expect.poll(() => CSS.highlights.get(highlightRegistryName("amber"))).toBeUndefined();
    } finally {
      reset();
    }
  });

  it("does not paint highlights when the rendered source belongs to another thread", async () => {
    reset();
    seed([
      highlight("highlight-1", "amber", "beta", 6, "alpha ", " gamma", "2026-01-01T00:00:00Z"),
    ]);
    try {
      await using _screen = await render(<Harness sourceThread={otherThreadRef} />);

      expect(CSS.highlights.get(highlightRegistryName("amber"))).toBeUndefined();
    } finally {
      reset();
    }
  });

  it("keeps another pane's contribution when a mounted painter has no highlights", async () => {
    reset();
    seed([
      highlight("highlight-1", "amber", "beta", 6, "alpha ", " gamma", "2026-01-01T00:00:00Z"),
    ]);
    try {
      await using _screen = await render(<Harness extraPainter />);

      await expect.poll(() => rangeText("amber")).toBe("beta");
    } finally {
      reset();
    }
  });

  it("repaints after the message text changes", async () => {
    reset();
    seed([
      highlight("highlight-1", "amber", "beta", 6, "alpha ", " gamma", "2026-01-01T00:00:00Z"),
    ]);
    try {
      await using screen = await render(<Harness />);

      await expect.poll(() => rangeText("amber")).toBe("beta");
      const before = Array.from(CSS.highlights.get(highlightRegistryName("amber"))!)[0];
      expect(before?.startOffset).toBe(6);

      const paragraph = screen.container.querySelector("p");
      if (!paragraph?.firstChild) throw new Error("Expected a paragraph");
      await act(() => {
        paragraph.firstChild!.textContent = "intro alpha beta gamma";
      });

      await expect.poll(() => rangeText("amber")).toBe("beta");
      const after = Array.from(CSS.highlights.get(highlightRegistryName("amber"))!)[0];
      expect(after?.startOffset).toBe(12);
    } finally {
      reset();
    }
  });

  it("clears the registries when the painter unmounts", async () => {
    reset();
    seed([
      highlight("highlight-1", "amber", "beta", 6, "alpha ", " gamma", "2026-01-01T00:00:00Z"),
    ]);
    try {
      const screen = await render(<Harness />);
      await expect.poll(() => rangeText("amber")).toBe("beta");

      await screen.unmount();

      await expect.poll(() => CSS.highlights.get(highlightRegistryName("amber"))).toBeUndefined();
    } finally {
      reset();
    }
  });

  it("keeps overlapping colors separate and orders them by recency", async () => {
    reset();
    seed([
      highlight("amber", "amber", "alpha beta", 0, "", " gamma", "2026-01-01T00:00:00Z"),
      highlight("blue", "blue", "beta gamma", 6, "alpha ", "", "2026-01-01T00:00:01Z"),
    ]);
    try {
      await using _screen = await render(<Harness />);

      await expect.poll(() => rangeText("amber")).toBe("alpha beta");
      await expect.poll(() => rangeText("blue")).toBe("beta gamma");
      const order = highlightOrder();
      expect(order.indexOf(highlightRegistryName("blue"))).toBeGreaterThan(
        order.indexOf(highlightRegistryName("amber")),
      );
    } finally {
      reset();
    }
  });
});
