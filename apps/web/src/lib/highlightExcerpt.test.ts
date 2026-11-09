import { describe, expect, it } from "vite-plus/test";

import {
  formatMarkdownFileHighlightExcerpt,
  formatMarkdownFileHighlightExcerpts,
} from "./highlightExcerpt";

describe("formatMarkdownFileHighlightExcerpt", () => {
  it("labels the file and quotes every selected line", () => {
    expect(
      formatMarkdownFileHighlightExcerpt({
        workspaceRoot: "/repo",
        relativePath: "docs/design.md",
        text: "first line\nsecond line",
      }),
    ).toBe("From `docs/design.md`:\n\n> first line\n> second line");
  });

  it("separates multiple excerpts with a blank line", () => {
    expect(
      formatMarkdownFileHighlightExcerpts([
        { workspaceRoot: "/repo", relativePath: "a.md", text: "one" },
        { workspaceRoot: "/repo", relativePath: "b.md", text: "two" },
      ]),
    ).toBe("From `a.md`:\n\n> one\n\nFrom `b.md`:\n\n> two");
  });
});
