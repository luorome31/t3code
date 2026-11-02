const HIGHLIGHT_COLOR_IDS = ["amber", "red", "green", "blue", "purple", "slate"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLOR_IDS)[number];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "amber";

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && (HIGHLIGHT_COLOR_IDS as readonly string[]).includes(value);
}
