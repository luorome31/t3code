import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  ThreadId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import {
  DEFAULT_HIGHLIGHT_COLOR_MODE,
  readThreadHighlights,
  useHighlightStore,
  type HighlightColor,
  type ThreadHighlight,
} from "~/highlightStore";
import { DEFAULT_HIGHLIGHT_COLOR } from "~/lib/highlightColors";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { render } from "../../../test/render";
import { AssistantHighlightPainter } from "./AssistantHighlightPainter";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const threadRef: ScopedThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-1"),
);

function Harness({
  onCite,
  text = "highlight me",
}: {
  onCite: (citation: AssistantCitation) => boolean;
  text?: string;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setViewport} style={{ width: 480, height: 200 }}>
      <div data-assistant-citation-source={MessageId.make("message-1")}>
        <p>{text}</p>
      </div>
      <AssistantSelectionToolbar
        viewport={viewport}
        threadRef={threadRef}
        onCite={(citation) => onCite(citation)}
      />
    </div>
  );
}

/** A timeline surface whose painted highlights the toolbar can click into. */
function PainterHarness({
  onCite,
  text = "highlight me",
  width = 480,
}: {
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
  text?: string;
  width?: number;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setViewport} style={{ width, height: 200 }}>
      <div
        data-assistant-citation-source={MessageId.make("message-1")}
        data-assistant-citation-environment="environment-1"
        data-assistant-citation-thread="thread-1"
      >
        <p>{text}</p>
      </div>
      <AssistantHighlightPainter container={viewport} threadRef={threadRef} />
      <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
    </div>
  );
}

function messageHighlight(input: {
  id: string;
  start: number;
  end: number;
  text: string;
  prefix: string;
  suffix: string;
  color: HighlightColor;
  createdAt: string;
  note?: string;
}): ThreadHighlight {
  return {
    id: input.id,
    source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
    selector: {
      text: input.text,
      start: input.start,
      end: input.end,
      prefix: input.prefix,
      suffix: input.suffix,
    },
    color: input.color,
    createdAt: input.createdAt,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
}

/** Center of one line box of the text range [start, end), in element-relative coordinates. */
function clickPositionIn(element: HTMLElement, start: number, end: number, rectIndex = 0) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!(node instanceof Text)) throw new Error("Expected a text node");
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const rect = range.getClientRects()[rectIndex] ?? range.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  return {
    x: rect.left - bounds.left + rect.width / 2,
    y: rect.top - bounds.top + rect.height / 2,
  };
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

function setup() {
  useHighlightStore.setState({
    byThreadKey: {},
    defaultColor: DEFAULT_HIGHLIGHT_COLOR,
    colorMode: DEFAULT_HIGHLIGHT_COLOR_MODE,
    threadDefaultColors: {},
  });
  if (typeof localStorage !== "undefined") localStorage.clear();
  window.getSelection()?.removeAllRanges();
}

describe("AssistantSelectionToolbar", () => {
  it("adds a highlight and toggles it off when the same text is selected again", async () => {
    setup();
    const onCite = vi.fn(() => true);
    await using screen = await render(<Harness onCite={onCite} />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect.element(page.getByRole("button", { name: "Highlight selection" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));

    expect(readThreadHighlights(threadRef)).toHaveLength(1);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect.element(page.getByRole("button", { name: "Remove highlight" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

    expect(readThreadHighlights(threadRef)).toHaveLength(0);
  });

  it("keeps a partially overlapping selection as a separate highlight", async () => {
    setup();
    await using screen = await render(<Harness onCite={() => true} />);

    selectText(screen.getByText("highlight me").element() as HTMLElement, 0, "highlight".length);
    await expect.element(page.getByRole("button", { name: "Highlight selection" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect.element(page.getByRole("button", { name: "Highlight selection" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));

    expect(readThreadHighlights(threadRef)).toHaveLength(2);
  });

  it("leaves the cite action available for selections too long to highlight", async () => {
    setup();
    const onCite = vi.fn((_citation: AssistantCitation) => true);
    await using screen = await render(<Harness onCite={onCite} />);
    const longText = "x".repeat(4_001);
    const source = screen.container.querySelector<HTMLElement>("[data-assistant-citation-source]");
    if (!source) throw new Error("Expected a citation source");
    const paragraph = source.querySelector("p");
    if (!paragraph) throw new Error("Expected a paragraph");
    paragraph.textContent = longText;

    selectText(paragraph);
    await expect
      .element(page.getByRole("button", { name: "Cite selection in composer" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: /Selection is too long to highlight/ }))
      .toBeDisabled();

    await userEvent.click(page.getByRole("button", { name: "Cite selection in composer" }));

    expect(onCite).toHaveBeenCalledOnce();
    expect(onCite.mock.calls[0]?.[0].text).toHaveLength(4_001);
  });

  it("toggles a selection that ends inside a whitespace run", async () => {
    setup();
    await using screen = await render(<Harness onCite={() => true} text="alpha beta   gamma" />);
    const paragraph = screen.getByText(/alpha beta/).element() as HTMLElement;
    const selectionEnd = "alpha beta ".length;

    selectText(paragraph, 0, selectionEnd);
    await expect.element(page.getByRole("button", { name: "Highlight selection" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));

    selectText(paragraph, 0, selectionEnd);
    await expect.element(page.getByRole("button", { name: "Remove highlight" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

    expect(readThreadHighlights(threadRef)).toHaveLength(0);
  });

  it("sets this thread's default color from the palette and highlights with it", async () => {
    setup();
    await using screen = await render(<Harness onCite={() => true} />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect.element(page.getByRole("button", { name: "Highlight selection" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Thread highlight color" }));
    await userEvent.click(page.getByRole("button", { name: "Set thread default to Purple" }));
    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));

    expect(readThreadHighlights(threadRef)[0]?.color).toBe("purple");
    expect(useHighlightStore.getState().threadDefaultColors["environment-1:thread-1"]).toBe(
      "purple",
    );
  });

  it("applies a one-off color from the palette without changing the thread default", async () => {
    setup();
    await using screen = await render(<Harness onCite={() => true} />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect.element(page.getByRole("button", { name: "Highlight selection" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Thread highlight color" }));
    await userEvent.click(page.getByRole("button", { name: "Highlight selection as Green" }));

    expect(readThreadHighlights(threadRef)[0]?.color).toBe("green");
    expect(useHighlightStore.getState().threadDefaultColors["environment-1:thread-1"]).toBe(
      undefined,
    );
  });

  it("offers per-selection color swatches in per-selection mode", async () => {
    setup();
    useHighlightStore.setState({ colorMode: "selection" });
    await using screen = await render(<Harness onCite={() => true} />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await userEvent.click(page.getByRole("button", { name: "Highlight selection as Blue" }));

    expect(readThreadHighlights(threadRef)[0]?.color).toBe("blue");
  });
});

describe("AssistantSelectionToolbar on painted highlights", () => {
  const plainHighlight = messageHighlight({
    id: "highlight-1",
    start: 0,
    end: 9,
    text: "highlight",
    prefix: "",
    suffix: " me",
    color: "amber",
    createdAt: "2026-01-01T00:00:00Z",
  });

  function seedPainted(highlights: readonly ThreadHighlight[]) {
    useHighlightStore.setState({
      byThreadKey: { "environment-1:thread-1": [...highlights] },
      defaultColor: DEFAULT_HIGHLIGHT_COLOR,
      colorMode: DEFAULT_HIGHLIGHT_COLOR_MODE,
      threadDefaultColors: {},
    });
    window.getSelection()?.removeAllRanges();
  }

  it("cites and removes a painted highlight from a plain click", async () => {
    seedPainted([plainHighlight]);
    const onCite = vi.fn(
      (_citation: AssistantCitation, _anchor: AssistantCitationSourceAnchor) => true,
    );
    await using screen = await render(<PainterHarness onCite={onCite} />);

    const paragraph = screen.getByText("highlight me").element() as HTMLElement;
    await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });

    await expect.element(page.getByRole("group", { name: "Highlight actions" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cite highlight in composer" }));

    expect(onCite).toHaveBeenCalledOnce();
    const [citation, anchor] = onCite.mock.calls[0]!;
    expect(citation).toMatchObject({
      version: 1,
      environmentId: "environment-1",
      threadId: "thread-1",
      messageId: MessageId.make("message-1"),
      text: "highlight",
      start: 0,
      end: 9,
    });
    expect(anchor.source.dataset.assistantCitationSource).toBe("message-1");
    expect(anchor.range.toString()).toBe("highlight");
    await expect
      .element(page.getByRole("group", { name: "Highlight actions" }))
      .not.toBeInTheDocument();

    await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });
    await expect.element(page.getByRole("group", { name: "Highlight actions" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

    expect(readThreadHighlights(threadRef)).toHaveLength(0);
  });

  it("carries a saved note as the citation comment when citing a painted highlight", async () => {
    seedPainted([{ ...plainHighlight, id: "highlight-2", note: "remember this" }]);
    const onCite = vi.fn((_citation: AssistantCitation) => true);
    await using screen = await render(<PainterHarness onCite={onCite} />);

    const paragraph = screen.getByText("highlight me").element() as HTMLElement;
    await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });
    await userEvent.click(page.getByRole("button", { name: "Cite highlight in composer" }));

    expect(onCite.mock.calls[0]?.[0].comment).toBe("remember this");
  });

  it("picks the highlight painted on top when records overlap", async () => {
    const older = messageHighlight({
      id: "highlight-old",
      start: 0,
      end: 9,
      text: "highlight",
      prefix: "",
      suffix: " me",
      color: "amber",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const newer = messageHighlight({
      id: "highlight-new",
      start: 0,
      end: 4,
      text: "high",
      prefix: "",
      suffix: "light me",
      color: "blue",
      createdAt: "2026-01-02T00:00:00Z",
    });
    seedPainted([older, newer]);
    await using screen = await render(<PainterHarness onCite={() => true} />);

    const paragraph = screen.getByText("highlight me").element() as HTMLElement;
    await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 4) });
    await expect.element(page.getByRole("group", { name: "Highlight actions" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

    expect(readThreadHighlights(threadRef).map((highlight) => highlight.id)).toEqual([
      "highlight-old",
    ]);
  });

  it("acts on the second line of a wrapped highlight", async () => {
    seedPainted([
      messageHighlight({
        id: "highlight-1",
        start: 6,
        end: 17,
        text: "beta gamma",
        prefix: "alpha ",
        suffix: " delta",
        color: "green",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ]);
    await using screen = await render(
      <PainterHarness onCite={() => true} text="alpha beta gamma delta" width={80} />,
    );

    const paragraph = screen.getByText(/alpha beta/).element() as HTMLElement;
    await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 6, 17, 1) });

    await expect.element(page.getByRole("group", { name: "Highlight actions" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

    expect(readThreadHighlights(threadRef)).toHaveLength(0);
  });

  it("does not open highlight actions for a click on plain text", async () => {
    seedPainted([]);
    await using screen = await render(<PainterHarness onCite={() => true} />);

    const paragraph = screen.getByText("highlight me").element() as HTMLElement;
    await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });

    await expect
      .poll(() => page.getByRole("group", { name: "Highlight actions" }).elements().length)
      .toBe(0);
    await expect
      .poll(() => page.getByRole("group", { name: "Selection actions" }).elements().length)
      .toBe(0);
  });

  it("replaces a selection toolbar with the clicked highlight's actions", async () => {
    seedPainted([plainHighlight]);
    await using screen = await render(<PainterHarness onCite={() => true} />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect.element(page.getByRole("group", { name: "Selection actions" })).toBeVisible();

    const paragraph = screen.getByText("highlight me").element() as HTMLElement;
    await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });

    await expect.element(page.getByRole("group", { name: "Highlight actions" })).toBeVisible();
    await expect
      .element(page.getByRole("group", { name: "Selection actions" }))
      .not.toBeInTheDocument();
  });
});
