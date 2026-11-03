import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { ThreadHighlightsRow } from "./ThreadHighlightsRow";

describe("ThreadHighlightsRow", () => {
  it("shows the count, including zero, and opens the panel", async () => {
    const onOpen = vi.fn();
    await using screen = await render(
      <ThreadHighlightsRow count={0} separated={false} onOpen={onOpen} />,
    );

    const row = page.getByRole("button", { name: /Highlights/ });
    await expect.element(row).toBeVisible();
    expect(row.element().textContent).toContain("Highlights");
    expect(row.element().textContent).toContain("0");

    await userEvent.click(row);
    expect(onOpen).toHaveBeenCalledOnce();

    await screen.rerender(<ThreadHighlightsRow count={3} separated={false} onOpen={onOpen} />);
    expect(row.element().textContent).toContain("3");
  });
});
