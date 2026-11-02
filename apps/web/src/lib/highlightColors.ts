const HIGHLIGHT_COLOR_IDS = ["amber", "red", "green", "blue", "purple", "slate"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLOR_IDS)[number];

export interface HighlightColorDefinition {
  readonly id: HighlightColor;
  readonly label: string;
}

export const HIGHLIGHT_COLORS: readonly HighlightColorDefinition[] = [
  { id: "amber", label: "Amber" },
  { id: "red", label: "Red" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Purple" },
  { id: "slate", label: "Slate" },
];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "amber";

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && (HIGHLIGHT_COLOR_IDS as readonly string[]).includes(value);
}

export function highlightRegistryName(
  color: HighlightColor,
): `t3-assistant-highlight-${HighlightColor}` {
  return `t3-assistant-highlight-${color}`;
}
