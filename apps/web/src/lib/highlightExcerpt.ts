import { msg } from "gt-react";

import type { MarkdownFileHighlightExcerpt } from "~/highlightStore";
import { m } from "~/i18n/messages";

export function formatMarkdownFileHighlightExcerpt(excerpt: MarkdownFileHighlightExcerpt): string {
  const quote = excerpt.text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  const attribution = `From \`${excerpt.relativePath}\`:\n\n${quote}`;
  return excerpt.comment === undefined
    ? attribution
    : `${attribution}\n\n${m(msg("Note: {note}", { note: excerpt.comment }))}`;
}

export function formatMarkdownFileHighlightExcerpts(
  excerpts: readonly MarkdownFileHighlightExcerpt[],
): string {
  return excerpts.map(formatMarkdownFileHighlightExcerpt).join("\n\n");
}
