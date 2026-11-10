import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { useRightPanelStore } from "../../rightPanelStore";
import { ThreadReplyOutlineRow } from "./ThreadReplyOutlineRow";

const mocks = vi.hoisted(() => ({
  outline: {
    status: "ready" as "ready" | "no-replies",
    messageId: "message-1" as string | null,
    headings: [
      { index: 0, level: 2, text: "Overview" },
      { index: 1, level: 2, text: "Details" },
    ] as { index: number; level: number; text: string }[],
  },
  requestOutlineNavigation: vi.fn(),
}));

vi.mock("./useActiveOutline", () => ({
  useActiveOutline: () => mocks.outline,
}));

vi.mock("./outlineStore", () => ({
  requestOutlineNavigation: mocks.requestOutlineNavigation,
}));

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

function setup() {
  mocks.outline.status = "ready";
  mocks.outline.messageId = "message-1";
  mocks.outline.headings = [
    { index: 0, level: 2, text: "Overview" },
    { index: 1, level: 2, text: "Details" },
  ];
  mocks.requestOutlineNavigation.mockClear();
  const open = vi.spyOn(useRightPanelStore.getState(), "open").mockImplementation(() => {});
  return { open, [Symbol.dispose]: () => open.mockRestore() };
}

describe("ThreadReplyOutlineRow", () => {
  it("shows the heading count and opens the panel from the row", async () => {
    using state = setup();
    await using _screen = await render(
      <ThreadReplyOutlineRow threadRef={threadRef} separated={false} />,
    );

    const row = page.getByRole("button", { name: /^Reply outline 2$/ });
    await expect.element(row).toBeVisible();
    expect(row.element().textContent).toContain("2");

    await userEvent.click(row);
    expect(state.open).toHaveBeenCalledWith(threadRef, "outline");
  });

  it("jumps to a heading from the chevron menu without opening the panel", async () => {
    using state = setup();
    await using _screen = await render(
      <ThreadReplyOutlineRow threadRef={threadRef} separated={false} />,
    );

    await userEvent.click(page.getByRole("button", { name: "Reply outline headings" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Details" }));

    expect(mocks.requestOutlineNavigation).toHaveBeenCalledWith(
      scopedThreadKey(threadRef),
      "message-1",
      1,
    );
    expect(state.open).not.toHaveBeenCalled();
  });

  it("renders nothing before a reply is in view", async () => {
    using _state = setup();
    mocks.outline.status = "no-replies";
    mocks.outline.messageId = null;
    mocks.outline.headings = [];
    await using _screen = await render(
      <ThreadReplyOutlineRow threadRef={threadRef} separated={false} />,
    );

    await expect.element(page.getByText("Reply outline")).not.toBeInTheDocument();
  });
});
