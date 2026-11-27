import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { consumeFileHighlightReveal, useFileHighlightReveal } from "~/fileHighlightRevealStore";
import {
  DEFAULT_HIGHLIGHT_COLOR_MODE,
  readThreadHighlights,
  useHighlightStore,
  type ThreadHighlight,
} from "~/highlightStore";
import { DEFAULT_HIGHLIGHT_COLOR } from "~/lib/highlightColors";
import type { HighlightDraftContent } from "~/lib/highlightDraftInsert";
import { render } from "../../../test/render";
import { ThreadHighlightsPanel } from "./ThreadHighlightsPanel";

const threadRef: ScopedThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-1"),
);
const otherThreadRef: ScopedThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-2"),
);

const entries: ThreadHighlight[] = [
  {
    id: "highlight-1",
    source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
    selector: { text: "alpha", start: 0, end: 5, prefix: "", suffix: " beta" },
    color: "amber",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "highlight-2",
    source: { kind: "assistant-message", messageId: MessageId.make("message-1") },
    selector: { text: "beta", start: 6, end: 10, prefix: "alpha ", suffix: " gamma" },
    color: "blue",
    createdAt: "2026-01-01T00:00:01.000Z",
  },
  {
    id: "highlight-3",
    source: { kind: "assistant-message", messageId: MessageId.make("message-2") },
    selector: { text: "delta", start: 0, end: 5, prefix: "", suffix: "" },
    color: "green",
    createdAt: "2026-01-01T00:00:02.000Z",
  },
];

const fileEntries: ThreadHighlight[] = [
  {
    id: "file-highlight-1",
    source: { kind: "markdown-file", workspaceRoot: "/repo", relativePath: "docs/design.md" },
    selector: { text: "rendered quote", start: 0, end: 14, prefix: "", suffix: "" },
    color: "purple",
    createdAt: "2026-01-01T00:00:03.000Z",
  },
  {
    id: "file-highlight-2",
    source: { kind: "markdown-file", workspaceRoot: "/repo", relativePath: "docs/design.md" },
    selector: { text: "second quote", start: 20, end: 32, prefix: "", suffix: "" },
    color: "amber",
    createdAt: "2026-01-01T00:00:04.000Z",
  },
];

function setup(highlights: ThreadHighlight[] = entries) {
  useHighlightStore.setState({
    byThreadKey: highlights.length === 0 ? {} : { [scopedThreadKey(threadRef)]: highlights },
    defaultColor: DEFAULT_HIGHLIGHT_COLOR,
    colorMode: DEFAULT_HIGHLIGHT_COLOR_MODE,
    threadDefaultColors: {},
  });
  localStorage.clear();
}

async function select(highlight: ThreadHighlight, position = 1) {
  await userEvent.click(
    page.getByRole("checkbox", {
      name: `Select highlight ${position}: ${highlight.selector.text.slice(0, 60)}`,
    }),
  );
}

function KeyedPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  return (
    <ThreadHighlightsPanel
      key={scopedThreadKey(threadRef)}
      threadRef={threadRef}
      onInsert={() => true}
    />
  );
}

describe("ThreadHighlightsPanel", () => {
  it("lists highlights and inserts the selected ones into the composer", async () => {
    setup();
    const onInsert = vi.fn((_content: HighlightDraftContent) => true);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={onInsert} />,
    );

    await expect.element(page.getByText("3 highlights")).toBeVisible();
    await expect.element(page.getByText("alpha")).toBeVisible();
    await expect.element(page.getByText("beta")).toBeVisible();
    const first = page.getByRole("article").filter({ hasText: "alpha" });
    await userEvent.click(first.getByRole("button", { name: "Context" }));
    await expect.element(first.getByText("alpha beta")).toBeVisible();
    await expect.element(page.getByText("delta")).toBeVisible();

    await select(entries[0]!);
    await select(entries[1]!, 2);
    await expect.element(page.getByText("2 selected")).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Merge into draft" }));

    expect(onInsert).toHaveBeenCalledOnce();
    const citations = onInsert.mock.calls[0]?.[0].citations ?? [];
    expect(citations.map((citation) => citation.text)).toEqual(["alpha", "beta"]);
    expect(citations.map((citation) => citation.messageId)).toEqual([
      MessageId.make("message-1"),
      MessageId.make("message-1"),
    ]);
  });

  it("recolors one highlight from its color swatch popover", async () => {
    setup();
    const onInsert = vi.fn(() => true);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={onInsert} />,
    );

    await userEvent.click(page.getByRole("button", { name: "Set color for highlight 1" }));
    await userEvent.click(page.getByRole("button", { name: "Blue" }));

    expect(
      readThreadHighlights(threadRef).find((highlight) => highlight.id === "highlight-1")?.color,
    ).toBe("blue");
  });

  it("keeps a dirty editor open when a filter or another row would hide it", async () => {
    setup();
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={() => true} />,
    );
    await userEvent.click(page.getByRole("button", { name: "Add note for highlight 1" }));
    const editor = page.getByRole("textbox", { name: "Add note" });
    await userEvent.type(editor, "unfinished note");
    const filter = page.getByRole("button", { name: "Filter Blue" });
    await userEvent.click(filter);
    await expect.element(filter).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(page.getByRole("button", { name: "Add note for highlight 2" }));
    await expect.element(editor).toHaveValue("unfinished note");
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    await userEvent.click(filter);
    await expect.element(filter).toHaveAttribute("aria-pressed", "true");
  });

  it("previews one note and inserts only the explicitly chosen note", async () => {
    setup(
      entries.map((entry) =>
        entry.id === "highlight-1"
          ? {
              ...entry,
              notes: [
                { id: "note-1", text: "remember this" },
                { id: "note-2", text: "follow up" },
              ],
            }
          : entry,
      ),
    );
    const onInsert = vi.fn((_content: HighlightDraftContent) => true);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={onInsert} />,
    );
    await expect.element(page.getByText("follow up")).toBeVisible();
    const card = page.getByRole("article").filter({ hasText: "remember this" });
    await userEvent.click(card.getByRole("button", { name: "Cite" }));
    expect(onInsert.mock.calls[0]?.[0].citations[0]?.comment).toBeUndefined();
    const note = page.getByRole("listitem").filter({ hasText: "follow up" });
    await userEvent.click(note.getByRole("button", { name: "Add to chat draft" }));
    expect(onInsert.mock.calls[1]?.[0].citations).toEqual([
      expect.objectContaining({ text: "alpha", comment: "follow up" }),
    ]);
  });

  it("filters highlights by color", async () => {
    setup();
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={() => true} />,
    );

    await userEvent.click(page.getByRole("button", { name: "Filter Amber" }));

    await expect.element(page.getByText("1 of 3 highlights")).toBeVisible();
    await expect.element(page.getByText("alpha")).toBeVisible();
    await expect.element(page.getByText("beta")).not.toBeInTheDocument();
    await expect.element(page.getByText("delta")).not.toBeInTheDocument();

    await userEvent.click(page.getByRole("checkbox", { name: "Select all highlights" }));
    await expect.element(page.getByText("1 selected")).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Filter Amber" }));
    await expect.element(page.getByText("3 highlights")).toBeVisible();
  });

  it("lets a filtered color without highlights in the tab be turned off", async () => {
    setup([...entries, ...fileEntries]);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={() => true} />,
    );

    await userEvent.click(page.getByRole("button", { name: "Filter Blue" }));
    await userEvent.click(page.getByRole("button", { name: "Markdown files" }));

    await expect.element(page.getByText("0 of 5 highlights")).toBeVisible();
    await expect.element(page.getByText("No highlights match the filter")).toBeVisible();

    const blueDot = page.getByRole("button", { name: "Filter Blue" });
    await expect.element(blueDot).not.toBeDisabled();
    await userEvent.click(blueDot);

    await expect.element(page.getByText("2 of 5 highlights")).toBeVisible();
    await expect.element(page.getByText("rendered quote")).toBeVisible();
  });

  it("deletes multiple selected highlights from the batch bar", async () => {
    setup();
    const onInsert = vi.fn(() => true);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={onInsert} />,
    );

    await select(entries[0]!);
    await select(entries[2]!, 3);
    await userEvent.click(page.getByRole("button", { name: "Delete" }));

    expect(readThreadHighlights(threadRef).map((highlight) => highlight.id)).toEqual([
      "highlight-2",
    ]);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("shows an empty state", async () => {
    setup([]);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={() => true} />,
    );

    await expect.element(page.getByText("No highlights yet")).toBeVisible();
  });

  it("keeps one group per message even when highlights interleave", async () => {
    setup([entries[0]!, { ...entries[2]!, createdAt: "2026-01-01T00:00:00.500Z" }, entries[1]!]);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={() => true} />,
    );

    await expect.poll(() => page.getByText("Assistant message").elements().length).toBe(2);
  });

  it("selects all highlights and clears the selection", async () => {
    setup();
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={() => true} />,
    );

    const selectAll = page.getByRole("checkbox", { name: "Select all highlights" });
    await userEvent.click(selectAll);
    await expect.element(page.getByText("3 selected")).toBeVisible();

    await userEvent.click(selectAll);
    await expect.element(page.getByText("3 selected")).not.toBeInTheDocument();
  });

  it("keeps the selection when the composer insert fails", async () => {
    setup();
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={() => false} />,
    );

    await select(entries[0]!);
    await userEvent.click(page.getByRole("button", { name: "Merge into draft" }));

    await expect.element(page.getByText("1 selected")).toBeVisible();
  });

  it("deletes a single highlight from its row button", async () => {
    setup();
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsert={() => true} />,
    );

    await userEvent.click(page.getByRole("button", { name: "Delete highlight 1" }));

    expect(readThreadHighlights(threadRef).map((highlight) => highlight.id)).toEqual([
      "highlight-2",
      "highlight-3",
    ]);
  });

  it("inserts Markdown excerpts and jumps to the selected highlight in a shared file", async () => {
    setup([...entries, ...fileEntries]);
    const onInsert = vi.fn((_content: HighlightDraftContent) => true);
    const file = {
      environmentId: threadRef.environmentId,
      workspaceRoot: "/repo",
      relativePath: "docs/design.md",
    };
    function FileReveal() {
      const reveal = useFileHighlightReveal(file);
      return (
        <>
          <output aria-label="Revealed quote">{reveal?.selector.text}</output>
          {reveal && (
            <button onClick={() => consumeFileHighlightReveal({ ...file, id: reveal.id })}>
              Clear reveal
            </button>
          )}
        </>
      );
    }
    await using _screen = await render(
      <>
        <ThreadHighlightsPanel threadRef={threadRef} onInsert={onInsert} />
        <FileReveal />
      </>,
    );

    await select(entries[0]!);
    await expect.element(page.getByText("1 selected")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Markdown files" }));

    await expect.element(page.getByText("docs/design.md")).toBeVisible();
    await expect.element(page.getByText("2 of 5 highlights")).toBeVisible();
    await expect.element(page.getByText("1 selected")).not.toBeInTheDocument();

    await select(fileEntries[0]!);
    await userEvent.click(page.getByRole("button", { name: "Merge into draft" }));

    expect(onInsert).toHaveBeenCalledOnce();
    expect(onInsert.mock.calls[0]?.[0].excerpts).toEqual([
      {
        workspaceRoot: "/repo",
        relativePath: "docs/design.md",
        text: "rendered quote",
      },
    ]);

    const second = page.getByRole("article").filter({ hasText: "second quote" });
    await userEvent.click(second.getByRole("button", { name: "Jump to source" }));
    await expect.element(page.getByLabelText("Revealed quote")).toHaveTextContent("second quote");
    await expect
      .element(page.getByRole("button", { name: "Open file", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Clear reveal" }));
  });

  it("drops the selection when a keyed panel moves to another thread and back", async () => {
    setup();
    await using screen = await render(<KeyedPanel threadRef={threadRef} />);

    await select(entries[0]!);
    await expect.element(page.getByText("1 selected")).toBeVisible();

    await screen.rerender(<KeyedPanel threadRef={otherThreadRef} />);
    await expect.element(page.getByText("No highlights yet")).toBeVisible();

    await screen.rerender(<KeyedPanel threadRef={threadRef} />);
    await expect.element(page.getByText("3 highlights")).toBeVisible();
    await expect.element(page.getByText("1 selected")).not.toBeInTheDocument();
  });
});
