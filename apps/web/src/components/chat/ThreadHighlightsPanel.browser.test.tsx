import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  ThreadId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { readThreadHighlights, useHighlightStore, type ThreadHighlight } from "~/highlightStore";
import { DEFAULT_HIGHLIGHT_COLOR } from "~/lib/highlightColors";
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
    messageId: MessageId.make("message-1"),
    selector: { text: "alpha", start: 0, end: 5, prefix: "", suffix: " beta" },
    color: "amber",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "highlight-2",
    messageId: MessageId.make("message-1"),
    selector: { text: "beta", start: 6, end: 10, prefix: "alpha ", suffix: " gamma" },
    color: "blue",
    createdAt: "2026-01-01T00:00:01.000Z",
  },
  {
    id: "highlight-3",
    messageId: MessageId.make("message-2"),
    selector: { text: "delta", start: 0, end: 5, prefix: "", suffix: "" },
    color: "green",
    createdAt: "2026-01-01T00:00:02.000Z",
  },
];

function setup(highlights: ThreadHighlight[] = entries) {
  useHighlightStore.setState({
    byThreadKey: highlights.length === 0 ? {} : { [scopedThreadKey(threadRef)]: highlights },
    defaultColor: DEFAULT_HIGHLIGHT_COLOR,
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
      onInsertHighlights={() => true}
    />
  );
}

describe("ThreadHighlightsPanel", () => {
  it("lists highlights and inserts the selected ones into the composer", async () => {
    setup();
    const onInsertHighlights = vi.fn((_citations: readonly AssistantCitation[]) => true);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsertHighlights={onInsertHighlights} />,
    );

    await expect.element(page.getByText("3 highlights")).toBeVisible();
    await expect.element(page.getByText("alpha")).toBeVisible();
    await expect.element(page.getByText("beta")).toBeVisible();
    await expect.element(page.getByText("delta")).toBeVisible();

    await select(entries[0]!);
    await select(entries[1]!, 2);
    await expect.element(page.getByText("2 selected")).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Insert into chat" }));

    expect(onInsertHighlights).toHaveBeenCalledOnce();
    const citations = onInsertHighlights.mock.calls[0]?.[0] ?? [];
    expect(citations.map((citation) => citation.text)).toEqual(["alpha", "beta"]);
    expect(citations.map((citation) => citation.messageId)).toEqual([
      MessageId.make("message-1"),
      MessageId.make("message-1"),
    ]);
  });

  it("recolors one highlight from its menu", async () => {
    setup();
    const onInsertHighlights = vi.fn(() => true);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsertHighlights={onInsertHighlights} />,
    );

    await userEvent.click(page.getByRole("button", { name: "Highlight actions for highlight 1" }));
    await userEvent.click(page.getByRole("menuitemradio", { name: /Blue/ }));

    expect(
      readThreadHighlights(threadRef).find((highlight) => highlight.id === "highlight-1")?.color,
    ).toBe("blue");
  });

  it("confirms and deletes multiple selected highlights", async () => {
    setup();
    const onInsertHighlights = vi.fn(() => true);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsertHighlights={onInsertHighlights} />,
    );

    await select(entries[0]!);
    await select(entries[2]!, 3);
    await userEvent.click(page.getByRole("button", { name: "Delete" }));

    await expect.element(page.getByText("Delete 2 highlights?")).toBeVisible();
    const dialog = page.getByRole("dialog");
    await userEvent.click(dialog.getByRole("button", { name: "Delete" }));

    expect(readThreadHighlights(threadRef).map((highlight) => highlight.id)).toEqual([
      "highlight-2",
    ]);
    expect(onInsertHighlights).not.toHaveBeenCalled();
  });

  it("shows an empty state", async () => {
    setup([]);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsertHighlights={() => true} />,
    );

    await expect.element(page.getByText("No highlights yet")).toBeVisible();
  });

  it("keeps one group per message even when highlights interleave", async () => {
    setup([entries[0]!, { ...entries[2]!, createdAt: "2026-01-01T00:00:00.500Z" }, entries[1]!]);
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsertHighlights={() => true} />,
    );

    await expect.poll(() => page.getByText("Assistant message").elements().length).toBe(2);
  });

  it("selects all highlights and clears the selection", async () => {
    setup();
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsertHighlights={() => true} />,
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
      <ThreadHighlightsPanel threadRef={threadRef} onInsertHighlights={() => false} />,
    );

    await select(entries[0]!);
    await userEvent.click(page.getByRole("button", { name: "Insert into chat" }));

    await expect.element(page.getByText("1 selected")).toBeVisible();
  });

  it("deletes a single highlight from its menu", async () => {
    setup();
    await using _screen = await render(
      <ThreadHighlightsPanel threadRef={threadRef} onInsertHighlights={() => true} />,
    );

    await userEvent.click(page.getByRole("button", { name: "Highlight actions for highlight 1" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Delete" }));

    expect(readThreadHighlights(threadRef).map((highlight) => highlight.id)).toEqual([
      "highlight-2",
      "highlight-3",
    ]);
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
