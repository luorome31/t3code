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

import { readThreadHighlights, useHighlightStore } from "~/highlightStore";
import { DEFAULT_HIGHLIGHT_COLOR } from "~/lib/highlightColors";
import { render } from "../../../test/render";
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
  useHighlightStore.setState({ byThreadKey: {}, defaultColor: DEFAULT_HIGHLIGHT_COLOR });
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
});
