import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import type { HighlightColor } from "~/lib/highlightColors";
import { render } from "../../../test/render";
import { HighlightColorPicker } from "./HighlightColorPicker";

function Harness() {
  const [color, setColor] = useState<HighlightColor>("amber");
  return <HighlightColorPicker value={color} onChange={setColor} />;
}

describe("HighlightColorPicker", () => {
  it("selects one color and updates the pressed state", async () => {
    await using _screen = await render(<Harness />);

    const green = page.getByRole("button", { name: "Green" });
    await expect.element(green).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(green);

    await expect.element(green).toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByRole("button", { name: "Amber" }))
      .toHaveAttribute("aria-pressed", "false");
  });
});
