import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import {
  readThreadHighlights,
  useHighlightStore,
  type MarkdownFileHighlightExcerpt,
  type ThreadHighlight,
} from "~/highlightStore";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  highlightRegistryName,
  type HighlightColor,
} from "~/lib/highlightColors";
import { render } from "../../../test/render";
import { RightPanelSheet } from "../RightPanelSheet";
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

/** A rendered Markdown surface whose painted highlights the toolbar can click into. */
function PaintedToolbarHarness({
  text = "highlight me",
  onCite,
}: {
  text?: string;
  onCite?: (excerpt: MarkdownFileHighlightExcerpt) => boolean;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setViewport} style={{ width: "min(100%, 480px)", height: 200, padding: "24px 8px" }}>
      <p>{text}</p>
      <MarkdownFileHighlightPainter
        container={viewport}
        threadRef={threadRef}
        workspaceRoot="/repo"
        relativePath="docs/design.md"
      />
      <MarkdownFileHighlightToolbar
        viewport={viewport}
        threadRef={threadRef}
        workspaceRoot="/repo"
        relativePath="docs/design.md"
        onCite={onCite}
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

  it("cites Markdown excerpts with a note only when explicitly inserted, and removes the highlight", async () => {
    reset();
    const highlight: ThreadHighlight = {
      id: "highlight-1",
      source: { kind: "markdown-file", workspaceRoot: "/repo", relativePath: "docs/design.md" },
      selector: { text: "highlight", start: 0, end: 9, prefix: "", suffix: " me" },
      color: "amber",
      createdAt: "2026-01-01T00:00:00Z",
      notes: [{ id: "note-1", text: "Revisit this decision" }],
    };
    useHighlightStore.setState({
      byThreadKey: { [`${threadRef.environmentId}:${threadRef.threadId}`]: [highlight] },
    });
    const onCite = vi.fn((_excerpt: MarkdownFileHighlightExcerpt) => true);
    try {
      await using screen = await render(<PaintedToolbarHarness onCite={onCite} />);

      const paragraph = screen.getByText("highlight me").element() as HTMLElement;
      await userEvent.click(paragraph, {
        position: clickPositionIn(paragraph, 0, 9),
      });

      await expect.element(page.getByRole("group", { name: "Highlight actions" })).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "Cite highlight in composer" }));

      expect(onCite).toHaveBeenCalledOnce();
      expect(onCite.mock.calls[0]?.[0]).toEqual({
        workspaceRoot: "/repo",
        relativePath: "docs/design.md",
        text: "highlight",
      });
      await expect
        .element(page.getByRole("group", { name: "Highlight actions" }))
        .not.toBeInTheDocument();

      await userEvent.click(page.getByRole("button", { name: "Open highlight notes (1)" }));
      await userEvent.click(page.getByRole("button", { name: "Add to chat draft" }));
      expect(onCite.mock.calls[1]?.[0]).toEqual({
        ...onCite.mock.calls[0]![0],
        comment: "Revisit this decision",
      });

      await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });
      await expect.element(page.getByRole("group", { name: "Highlight actions" })).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "More highlight actions" }));
      await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

      expect(readThreadHighlights(threadRef)).toHaveLength(0);
    } finally {
      reset();
    }
  });

  it.each([850, 390])("opens a Markdown note inside the workspace sheet at %spx", async (width) => {
    reset();
    await page.viewport(width, 750);
    const highlight = fileHighlight("sheet-highlight", "docs/design.md", "beta", 6, "amber");
    useHighlightStore.setState({
      byThreadKey: {
        [`${threadRef.environmentId}:${threadRef.threadId}`]: [
          { ...highlight, notes: [{ id: "note-1", text: "A note inside the sheet" }] },
        ],
      },
    });
    await using _screen = await render(
      <RightPanelSheet open onClose={() => {}} animationDurationMs={0}>
        <PaintedToolbarHarness text="alpha beta gamma" />
      </RightPanelSheet>,
    );
    const workspace = page.getByRole("dialog", { name: "Workspace panel" });
    const marker = workspace.getByRole("button", { name: "Open highlight notes (1)" });
    await userEvent.click(marker);
    const notes = page.getByRole("dialog", { name: "Highlight notes" });
    await expect.element(notes.getByText("A note inside the sheet")).toBeVisible();
    await userEvent.click(notes.getByRole("button", { name: "Add note" }));
    await expect.element(notes.getByRole("textbox", { name: "Add note" })).toHaveFocus();
  });

  it("does not open highlight actions for a click on plain text", async () => {
    reset();
    try {
      await using _screen = await render(<PaintedToolbarHarness />);

      const paragraph = _screen.getByText("highlight me").element() as HTMLElement;
      await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });

      await expect
        .poll(() => page.getByRole("group", { name: "Highlight actions" }).elements().length)
        .toBe(0);
    } finally {
      reset();
    }
  });
});

/** Center of one line box of the text range [start, end), in element-relative coordinates. */
function clickPositionIn(element: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!(node instanceof Text)) throw new Error("Expected a text node");
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const rect = range.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  return {
    x: rect.left - bounds.left + rect.width / 2,
    y: rect.top - bounds.top + rect.height / 2,
  };
}
