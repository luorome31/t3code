import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import {
  DEFAULT_HIGHLIGHT_COLOR_MODE,
  useHighlightStore,
  type HighlightColor,
} from "~/highlightStore";
import { DEFAULT_HIGHLIGHT_COLOR } from "~/lib/highlightColors";
import { render } from "../../../test/render";
import { HighlightToolbarActions } from "./HighlightToolbarActions";

const threadRef: ScopedThreadRef = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-1"),
);

function Harness({
  onAdd,
  onRemove,
}: {
  readonly onAdd: (color: HighlightColor) => void;
  readonly onRemove: () => void;
}) {
  const [existing, setExisting] = useState(false);
  return (
    <HighlightToolbarActions
      threadRef={threadRef}
      supported={true}
      tooLong={false}
      hasExistingHighlight={existing}
      onAdd={(color) => {
        onAdd(color);
        setExisting(true);
      }}
      onRemove={() => {
        onRemove();
        setExisting(false);
      }}
    />
  );
}

function setup() {
  useHighlightStore.setState({
    byThreadKey: {},
    defaultColor: DEFAULT_HIGHLIGHT_COLOR,
    colorMode: DEFAULT_HIGHLIGHT_COLOR_MODE,
    threadDefaultColors: {},
  });
  localStorage.clear();
}

describe("HighlightToolbarActions", () => {
  it("expands the thread palette inline and picks a default color", async () => {
    setup();
    const onAdd = vi.fn();
    await using _screen = await render(<Harness onAdd={onAdd} onRemove={() => {}} />);

    await userEvent.click(page.getByRole("button", { name: "Thread highlight color" }));
    await expect
      .element(page.getByRole("group", { name: "Thread highlight palette" }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Purple", exact: true }));

    expect(useHighlightStore.getState().threadDefaultColors["environment-1:thread-1"]).toBe(
      "purple",
    );
    await expect
      .element(page.getByRole("group", { name: "Thread highlight palette" }))
      .not.toBeInTheDocument();

    await userEvent.click(page.getByRole("button", { name: "Highlight selection" }));
    expect(onAdd).toHaveBeenCalledWith("purple");
  });

  it("shows per-selection swatches and removes an existing highlight", async () => {
    setup();
    useHighlightStore.setState({ colorMode: "selection" });
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    await using _screen = await render(<Harness onAdd={onAdd} onRemove={onRemove} />);

    await userEvent.click(page.getByRole("button", { name: "Highlight selection as Blue" }));
    expect(onAdd).toHaveBeenCalledWith("blue");

    await expect.element(page.getByRole("button", { name: "Remove highlight" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Remove highlight" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
