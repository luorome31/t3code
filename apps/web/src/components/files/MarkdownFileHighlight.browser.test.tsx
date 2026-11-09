import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { readThreadHighlights, useHighlightStore, type ThreadHighlight } from "~/highlightStore";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  highlightRegistryName,
  type HighlightColor,
} from "~/lib/highlightColors";
import { render } from "../../../test/render";
import { FileMarkdownPreview } from "./FileMarkdownPreview";
import { MarkdownFileHighlightPainter } from "./MarkdownFileHighlightPainter";
import { MarkdownFileHighlightToolbar } from "./MarkdownFileHighlightToolbar";

const threadRef: ScopedThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-1"),
);

function reset() {
  useHighlightStore.setState({ byThreadKey: {}, defaultColor: DEFAULT_HIGHLIGHT_COLOR });
  localStorage.clear();
  if (typeof CSS !== "undefined" && CSS.highlights) {
    for (const color of HIGHLIGHT_COLORS) CSS.highlights.delete(highlightRegistryName(color.id));
  }
  window.getSelection()?.removeAllRanges();
}

function fileHighlight(
  id: string,
  relativePath: string,
  text: string,
  start: number,
  color: HighlightColor,
): ThreadHighlight {
  return {
    id,
    source: { kind: "markdown-file", workspaceRoot: "/repo", relativePath },
    selector: {
      text,
      start,
      end: start + text.length,
      prefix: "alpha ",
      suffix: " gamma",
    },
    color,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function PainterHarness({
  relativePath = "docs/design.md",
  text = "alpha beta gamma",
}: {
  relativePath?: string;
  text?: string;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer}>
      <p>{text}</p>
      <MarkdownFileHighlightPainter
        container={container}
        threadRef={threadRef}
        workspaceRoot="/repo"
        relativePath={relativePath}
      />
    </div>
  );
}

function ToolbarHarness({ text = "highlight me" }: { text?: string }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setViewport} style={{ width: 480, height: 200 }}>
      <p>{text}</p>
      <MarkdownFileHighlightToolbar
        viewport={viewport}
        threadRef={threadRef}
        workspaceRoot="/repo"
        relativePath="docs/design.md"
      />
    </div>
  );
}

function selectText(element: HTMLElement, start = 0, end?: number) {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  // The toolbar dismisses until the next pointer or key gesture; a synthetic selection needs one.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!(node instanceof Text)) throw new Error("Expected a text node");
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end ?? node.length);
  const selection = window.getSelection();
  if (!selection) throw new Error("Expected a selection");
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("MarkdownFileHighlightPainter", () => {
  it("paints highlights for the open file and ignores another file", async () => {
    reset();
    useHighlightStore.setState({
      byThreadKey: {
        [`${threadRef.environmentId}:${threadRef.threadId}`]: [
          fileHighlight("highlight-1", "docs/design.md", "beta", 6, "amber"),
        ],
      },
      defaultColor: DEFAULT_HIGHLIGHT_COLOR,
    });
    try {
      await using _screen = await render(<PainterHarness />);

      await expect.poll(() => CSS.highlights.get(highlightRegistryName("amber"))?.size).toBe(1);
      await using _other = await render(<PainterHarness relativePath="docs/other.md" />);
      await expect.poll(() => CSS.highlights.get(highlightRegistryName("amber"))?.size).toBe(1);
    } finally {
      reset();
    }
  });
});

describe("FileMarkdownPreview highlight reveal", () => {
  it("scrolls to the requested highlight and reports it handled", async () => {
    reset();
    using scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const onHandled = vi.fn();
    await using _screen = await render(
      <FileMarkdownPreview
        cwd="/repo"
        relativePath="docs/design.md"
        text="alpha beta gamma"
        threadRef={threadRef}
        workspaceMutationId={null}
        revealHighlight={{
          id: 7,
          selector: { text: "beta", start: 6, end: 10, prefix: "alpha ", suffix: " gamma" },
        }}
        onHighlightRevealHandled={onHandled}
      />,
    );

    await vi.waitFor(() => expect(onHandled).toHaveBeenCalledWith(7));
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe("MarkdownFileHighlightToolbar", () => {
  it("adds a highlight scoped to the rendered Markdown file", async () => {
    reset();
    await using screen = await render(<ToolbarHarness />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect.element(page.getByRole("button", { name: "Highlight selection" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));

    const highlights = readThreadHighlights(threadRef);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.source).toEqual({
      kind: "markdown-file",
      workspaceRoot: "/repo",
      relativePath: "docs/design.md",
    });
    expect(highlights[0]?.selector.text).toBe("highlight me");
  });

  it("removes the highlight when the same text is selected again", async () => {
    reset();
    await using screen = await render(<ToolbarHarness />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));
    expect(readThreadHighlights(threadRef)).toHaveLength(1);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect.element(page.getByRole("button", { name: "Remove highlight" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

    expect(readThreadHighlights(threadRef)).toHaveLength(0);
  });
});
