import type { MarkdownFileHighlightExcerpt } from "~/highlightStore";

export function formatMarkdownFileHighlightExcerpt(excerpt: MarkdownFileHighlightExcerpt): string {
  const quote = excerpt.text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `From \`${excerpt.relativePath}\`:\n\n${quote}`;
}

export function formatMarkdownFileHighlightExcerpts(
  excerpts: readonly MarkdownFileHighlightExcerpt[],
): string {
  return excerpts.map(formatMarkdownFileHighlightExcerpt).join("\n\n");
}
