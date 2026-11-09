export interface MessageOutlineHeading {
  /** Position among the message's rendered headings, used as the jump target. */
  readonly index: number;
  readonly level: number;
  readonly text: string;
}

const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";
const OUTLINE_CACHE_LIMIT = 64;

interface OutlineCacheEntry {
  readonly version: unknown;
  readonly headings: readonly MessageOutlineHeading[];
}

const outlineCache = new Map<string, OutlineCacheEntry>();

/** A completed reply's headings do not change, so revisiting one skips the DOM read. */
export function cachedMessageOutline(
  messageId: string,
  version: unknown,
): readonly MessageOutlineHeading[] | undefined {
  const entry = outlineCache.get(messageId);
  return entry !== undefined && entry.version === version ? entry.headings : undefined;
}

/** Headings belonging to this Markdown root, excluding nested embedded Markdown documents. */
export function outlineHeadingElements(root: HTMLElement): readonly HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)).filter(
    (heading) => heading.closest(".chat-markdown") === root,
  );
}

/**
 * KaTeX renders the visual formula and a hidden MathML copy, so read its
 * source instead of duplicating the equation in the label.
 */
function headingText(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  for (const math of clone.querySelectorAll<HTMLElement>("[data-markdown-math]")) {
    math.replaceWith(document.createTextNode(math.dataset.markdownCopy ?? math.textContent ?? ""));
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Reads the headings from a message's rendered DOM. The active reply is mounted
 * while it is on screen, so the DOM is the exact set of targets the outline shows.
 */
export function readMessageOutline(
  messageId: string,
  version?: unknown,
): readonly MessageOutlineHeading[] | null {
  if (typeof document === "undefined") return null;
  let markdownRoot: HTMLElement | null = null;
  for (const row of document.querySelectorAll<HTMLElement>("[data-message-id]")) {
    if (row.dataset.messageId !== messageId) continue;
    markdownRoot = row.querySelector<HTMLElement>(".chat-markdown");
    if (markdownRoot !== null) break;
  }
  if (markdownRoot === null) return null;
  const headings = outlineHeadingElements(markdownRoot).map((heading, index) => ({
    index,
    level: Number.parseInt(heading.tagName.slice(1), 10),
    text: headingText(heading) || "Untitled section",
  }));
  outlineCache.set(messageId, { version, headings });
  if (outlineCache.size > OUTLINE_CACHE_LIMIT) {
    const oldest = outlineCache.keys().next().value;
    if (oldest !== undefined) outlineCache.delete(oldest);
  }
  return headings;
}
