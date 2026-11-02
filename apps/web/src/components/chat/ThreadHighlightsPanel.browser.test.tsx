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

async function select(highlight: ThreadHighlight) {
  await userEvent.click(
    page.getByRole("checkbox", {
      name: `Select highlight: ${highlight.selector.text.slice(0, 60)}`,
    }),
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
    await select(entries[1]!);
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

    await userEvent.click(page.getByRole("button", { name: "Highlight actions" }).first());
    await userEvent.click(page.getByRole("menuitem", { name: /Blue/ }));

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
    await select(entries[2]!);
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
});
