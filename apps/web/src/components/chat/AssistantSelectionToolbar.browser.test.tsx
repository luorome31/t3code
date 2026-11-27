import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  SmalltalkError,
  ThreadId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
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
import { DEFAULT_HIGHLIGHT_COLOR, highlightRegistryName } from "~/lib/highlightColors";
import { topmostHighlightHitAt } from "~/lib/highlightHitTargets";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { act, render } from "../../../test/render";
import { useRightPanelStore } from "../../rightPanelStore";
import { toastManager } from "../ui/toast";
import { AssistantHighlightPainter } from "./AssistantHighlightPainter";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const smalltalkState = vi.hoisted(() => ({
  config: false,
  mutate: vi.fn(),
  openPanel: vi.fn(),
}));

vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const smalltalkExcerptConfig = Atom.make({
    environment: {
      platform: { os: "linux" },
      capabilities: { smalltalk: true, smalltalkExcerptSource: true },
    },
  });
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      configValueAtom: (() => (smalltalkState.config ? smalltalkExcerptConfig : noConfig)) as never,
    },
  };
});
vi.mock(import("~/state/smalltalk"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  return {
    ...actual,
    smalltalkEnvironment: {
      ...actual.smalltalkEnvironment,
      mutate: { ...actual.smalltalkEnvironment.mutate, permissionAtom: () => Atom.make(true) },
    },
    selectedSmalltalkAtom: (() => Atom.make<string | null>(null)) as never,
  };
});
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => smalltalkState.mutate) as never,
}));

const threadRef: ScopedThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-1"),
);

function Harness({
  onCite,
  text = "highlight me",
  excerptSource = false,
}: {
  onCite: (citation: AssistantCitation) => boolean;
  text?: string;
  /** Marks the source as a completed real assistant message, as the timeline does. */
  excerptSource?: boolean;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setViewport} style={{ width: 480, height: 200 }}>
      <div
        data-assistant-citation-source={MessageId.make("message-1")}
        {...(excerptSource ? { "data-assistant-excerpt-source": "true" } : {})}
      >
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
  onInsertNote,
  text = "highlight me",
  width = 480,
}: {
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
  onInsertNote?: (citation: AssistantCitation) => boolean;
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
        {text.split("\n").map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <AssistantHighlightPainter container={viewport} threadRef={threadRef} />
      <AssistantSelectionToolbar
        viewport={viewport}
        threadRef={threadRef}
        onCite={onCite}
        onInsertNote={onInsertNote}
      />
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
  smalltalkState.config = false;
  smalltalkState.mutate.mockReset();
  smalltalkState.openPanel.mockReset();
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

  it("applies a palette color to the selection and makes it the thread default", async () => {
    setup();
    await using screen = await render(<Harness onCite={() => true} />);

    const paragraph = screen.getByText("highlight me").element() as HTMLElement;
    selectText(paragraph);
    await expect.element(page.getByRole("button", { name: "Highlight selection" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Thread highlight color" }));
    await userEvent.click(
      page.getByRole("button", {
        name: "Highlight selection as Purple and set the thread default",
      }),
    );

    expect(readThreadHighlights(threadRef)[0]?.color).toBe("purple");
    expect(useHighlightStore.getState().threadDefaultColors["environment-1:thread-1"]).toBe(
      "purple",
    );

    selectText(paragraph, 0, "highlight".length);
    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));

    expect(readThreadHighlights(threadRef)[1]?.color).toBe("purple");
  });

  it("offers per-selection color swatches in per-selection mode", async () => {
    setup();
    useHighlightStore.setState({
      colorMode: "selection",
      threadDefaultColors: { "environment-1:thread-1": "purple" },
    });
    await using screen = await render(<Harness onCite={() => true} />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await userEvent.click(page.getByRole("button", { name: "Highlight selection as Blue" }));

    expect(readThreadHighlights(threadRef)[0]?.color).toBe("blue");
    expect(useHighlightStore.getState().threadDefaultColors["environment-1:thread-1"]).toBe(
      "purple",
    );
  });
});

describe("AssistantSelectionToolbar plain-language explain", () => {
  it("explains the selected text of a completed assistant message as an excerpt", async () => {
    setup();
    smalltalkState.config = true;
    smalltalkState.mutate.mockResolvedValue(AsyncResult.success({ id: "smalltalk-1" }));
    await using screen = await render(<Harness onCite={() => true} excerptSource />);
    const { open } = useRightPanelStore.getState();
    using _panel = {
      [Symbol.dispose]: () => useRightPanelStore.setState({ open }),
    };
    useRightPanelStore.setState({ open: smalltalkState.openPanel });

    selectText(screen.getByText("highlight me").element() as HTMLElement, 0, "highlight".length);
    await userEvent.click(
      page.getByRole("button", { name: "Explain selection in plain language" }),
    );

    expect(smalltalkState.mutate).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: {
        action: "create",
        threadId: threadRef.threadId,
        source: {
          kind: "excerpt",
          messageId: MessageId.make("message-1"),
          text: "highlight",
          start: 0,
          end: 9,
          prefix: "",
          suffix: " me",
        },
      },
    });
    expect(smalltalkState.openPanel).toHaveBeenCalledWith(threadRef, "smalltalk");
    await expect
      .element(page.getByRole("group", { name: "Selection actions" }))
      .not.toBeInTheDocument();
  });

  it("keeps the selection and warns when the explanation cannot be created", async () => {
    setup();
    smalltalkState.config = true;
    smalltalkState.mutate.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new SmalltalkError({ reason: "invalid_source" }))),
    );
    using toast = vi.spyOn(toastManager, "add");
    await using screen = await render(<Harness onCite={() => true} excerptSource />);

    selectText(screen.getByText("highlight me").element() as HTMLElement, 0, "highlight".length);
    await userEvent.click(
      page.getByRole("button", { name: "Explain selection in plain language" }),
    );

    await vi.waitFor(() => expect(toast).toHaveBeenCalledOnce());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "warning",
        title: "Could not create this explanation",
        description: "Choose a completed, nonempty response in this thread.",
      }),
    );
    await expect.element(page.getByRole("group", { name: "Selection actions" })).toBeVisible();
    expect(smalltalkState.openPanel).not.toHaveBeenCalled();
  });

  it("hides the explain action for selections the server would reject", async () => {
    setup();
    smalltalkState.config = true;
    await using screen = await render(<Harness onCite={() => true} />);

    selectText(screen.getByText("highlight me").element() as HTMLElement);
    await expect
      .element(page.getByRole("button", { name: "Cite selection in composer" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Explain selection in plain language" }))
      .not.toBeInTheDocument();
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
      existingPaletteExpanded: false,
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
    await userEvent.click(page.getByRole("button", { name: "More highlight actions" }));
    await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

    expect(readThreadHighlights(threadRef)).toHaveLength(0);
  });

  it("recolors only the clicked highlight using the keyboard and keeps its actions open", async () => {
    const other = messageHighlight({
      id: "highlight-2",
      start: 10,
      end: 12,
      text: "me",
      prefix: "highlight ",
      suffix: "",
      color: "green",
      createdAt: "2026-01-01T00:00:00Z",
    });
    seedPainted([plainHighlight, other]);
    await page.viewport(900, 700);
    await using screen = await render(<PainterHarness onCite={() => true} width={680} />);
    const paragraph = screen.getByText("highlight me").element() as HTMLElement;
    await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });

    const actions = page.getByRole("group", { name: "Highlight actions" });
    const trigger = actions.getByRole("button", { name: "Change highlight color: Amber" });
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    const palette = actions.getByRole("group", { name: "Highlight color" });
    await expect
      .element(palette.getByRole("button", { name: "Amber" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(palette.element().getBoundingClientRect().left).toBeGreaterThan(
      actions.element().getBoundingClientRect().right,
    );
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(palette.getByRole("button", { name: "Red" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    const recoloredTrigger = actions.getByRole("button", { name: "Change highlight color: Red" });
    await expect.element(recoloredTrigger).toHaveFocus();
    await expect.element(palette).not.toBeInTheDocument();
    expect(readThreadHighlights(threadRef)).toEqual([{ ...plainHighlight, color: "red" }, other]);
    expect(CSS.highlights.get(highlightRegistryName("red"))?.size).toBe(1);
    expect(CSS.highlights.get(highlightRegistryName("green"))?.size).toBe(1);

    await userEvent.keyboard("{Enter}{Escape}");
    await expect.element(recoloredTrigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(paragraph, { position: { x: 400, y: 8 } });
    await expect.element(actions).not.toBeInTheDocument();
  });

  it("adds and edits notes next to the highlight, and only inserts the selected note", async () => {
    seedPainted([plainHighlight]);
    const onCite = vi.fn((_citation: AssistantCitation) => true);
    const onInsertNote = vi.fn((_citation: AssistantCitation) => true);
    await using screen = await render(
      <PainterHarness onCite={onCite} onInsertNote={onInsertNote} />,
    );
    const paragraph = screen.getByText("highlight me").element() as HTMLElement;
    const clickHighlight = () =>
      userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 9) });
    await clickHighlight();
    await userEvent.click(page.getByRole("button", { name: "Add note" }));
    const dialog = page.getByRole("dialog", { name: "Highlight notes" });
    const editor = dialog.getByRole("textbox", { name: "Add note" });
    await expect.element(editor).toHaveFocus();
    await userEvent.type(editor, "remember this");
    const save = dialog.getByRole("button", { name: "Save note" });
    {
      using _write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Storage is full", "QuotaExceededError");
      });
      await userEvent.click(save);
      await expect.element(editor).toHaveValue("remember this");
      expect(readThreadHighlights(threadRef)[0]?.notes).toBeUndefined();
    }
    await userEvent.click(save);
    await userEvent.click(dialog.getByRole("button", { name: "Add note" }));
    await userEvent.type(editor, "second note");
    await userEvent.keyboard("{Enter}");
    const second = dialog.getByRole("listitem").filter({ hasText: "second note" });
    await expect.element(second.getByRole("button", { name: "Add to chat draft" })).toHaveFocus();
    await userEvent.click(second.getByRole("button", { name: "Note actions" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Edit note" }));
    const edit = dialog.getByRole("textbox", { name: "Edit note" });
    await userEvent.clear(edit);
    await userEvent.type(edit, "follow up");
    await userEvent.click(dialog.getByRole("button", { name: "Save note" }));
    await userEvent.click(dialog.getByRole("button", { name: "Close notes" }));
    await expect.element(dialog).not.toBeInTheDocument();

    await clickHighlight();
    await userEvent.click(page.getByRole("button", { name: "Cite highlight in composer" }));
    expect(onCite.mock.calls[0]?.[0].comment).toBeUndefined();
    await userEvent.click(page.getByRole("button", { name: "Open highlight notes (2)" }));
    const first = dialog.getByRole("listitem").filter({ hasText: "remember this" });
    await userEvent.click(first.getByRole("button", { name: "Note actions" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Delete note" }));
    await userEvent.click(
      dialog
        .getByRole("listitem")
        .filter({ hasText: "follow up" })
        .getByRole("button", { name: "Add to chat draft" }),
    );
    expect(onInsertNote.mock.calls[0]?.[0]).toMatchObject({
      text: "highlight",
      comment: "follow up",
    });
    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Open highlight notes (1)" }))
      .toBeVisible();
  });

  it("keeps a dirty note when another source marker is clicked", async () => {
    seedPainted([
      { ...plainHighlight, notes: [{ id: "first", text: "first note" }] },
      {
        ...plainHighlight,
        id: "second-highlight",
        selector: {
          text: "another source farther along",
          start: 13,
          end: 41,
          prefix: "highlight me ",
          suffix: "",
        },
        notes: [
          { id: "second", text: "second note" },
          { id: "third", text: "third note" },
        ],
      },
    ]);
    await using _screen = await render(
      <PainterHarness onCite={() => true} text="highlight me another source farther along" />,
    );
    await userEvent.click(page.getByRole("button", { name: "Open highlight notes (1)" }));
    const dialog = page.getByRole("dialog", { name: "Highlight notes" });
    await userEvent.click(dialog.getByRole("button", { name: "Add note" }));
    const editor = dialog.getByRole("textbox", { name: "Add note" });
    await userEvent.type(editor, "unfinished note");
    const otherMarker = document.querySelector<HTMLButtonElement>(
      '[aria-label="Open highlight notes (2)"]',
    );
    expect(otherMarker).not.toBeNull();
    await act(() => otherMarker?.click());
    await expect.element(editor).toHaveValue("unfinished note");
    await userEvent.click(dialog.getByRole("button", { name: "Close notes" }));
    await expect.element(editor).toHaveValue("unfinished note");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await act(() => otherMarker?.click());
    await expect.element(dialog.getByText("second note", { exact: true })).toBeVisible();
  });

  it.each(["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"])(
    "picks the highlight painted on top when records overlap (second created at %s)",
    async (createdAt) => {
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
        createdAt,
      });
      seedPainted([older, newer]);
      await using screen = await render(<PainterHarness onCite={() => true} />);

      const paragraph = screen.getByText("highlight me").element() as HTMLElement;
      await userEvent.click(paragraph, { position: clickPositionIn(paragraph, 0, 4) });
      await expect.element(page.getByRole("group", { name: "Highlight actions" })).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "More highlight actions" }));
      await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));

      expect(readThreadHighlights(threadRef).map((highlight) => highlight.id)).toEqual([
        "highlight-old",
      ]);
    },
  );

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
    await userEvent.click(page.getByRole("button", { name: "More highlight actions" }));
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

  it("hits the text but not the blank area of a highlighted paragraph", async () => {
    seedPainted([
      {
        ...plainHighlight,
        selector: { text: "first middle last", start: 0, end: 17, prefix: "", suffix: "" },
      },
    ]);
    await using screen = await render(
      <PainterHarness onCite={() => true} text={"first\nmiddle\nlast"} />,
    );

    await vi.waitFor(() =>
      expect(CSS.highlights.get(highlightRegistryName(plainHighlight.color))?.size).toBe(1),
    );
    const paragraph = screen.getByText("middle", { exact: true }).element();
    const viewport = paragraph.parentElement!.parentElement!;
    const box = paragraph.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(paragraph);
    const glyphs = text.getBoundingClientRect();
    const y = glyphs.top + glyphs.height / 2;

    expect(topmostHighlightHitAt(viewport, glyphs.left + glyphs.width / 2, y)?.id).toBe(
      plainHighlight.id,
    );
    expect(topmostHighlightHitAt(viewport, box.right - 10, y)).toBeNull();
  });

  it("keeps the clicked highlight when the text moves after mouseup", async () => {
    seedPainted([
      {
        ...plainHighlight,
        selector: { text: "first", start: 0, end: 5, prefix: "", suffix: " middle" },
      },
      {
        ...plainHighlight,
        id: "highlight-2",
        selector: { text: "middle", start: 6, end: 12, prefix: "first ", suffix: "" },
      },
    ]);
    const onCite = vi.fn((_citation: AssistantCitation) => true);
    await using screen = await render(<PainterHarness onCite={onCite} text={"first\nmiddle"} />);
    await vi.waitFor(() =>
      expect(CSS.highlights.get(highlightRegistryName(plainHighlight.color))?.size).toBe(2),
    );

    const first = screen.getByText("first", { exact: true }).element() as HTMLElement;
    const second = screen.getByText("middle", { exact: true }).element();
    const distance = second.getBoundingClientRect().top - first.getBoundingClientRect().top;
    const moveText = () => {
      first.parentElement!.style.transform = `translateY(-${distance}px)`;
    };
    window.addEventListener("mouseup", moveText, { once: true });
    using _listener = {
      [Symbol.dispose]: () => window.removeEventListener("mouseup", moveText),
    };

    await userEvent.click(first, { position: clickPositionIn(first, 0, 5) });
    await userEvent.click(page.getByRole("button", { name: "Cite highlight in composer" }));

    expect(onCite.mock.calls[0]?.[0].text).toBe("first");
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
