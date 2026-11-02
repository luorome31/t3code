const HIGHLIGHT_COLOR_IDS = ["amber", "red", "green", "blue", "purple", "slate"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLOR_IDS)[number];

export interface HighlightColorDefinition {
  readonly id: HighlightColor;
  readonly label: string;
  readonly cssVariable: `--highlight-${HighlightColor}`;
}

export const HIGHLIGHT_COLORS: readonly HighlightColorDefinition[] = [
  { id: "amber", label: "Amber", cssVariable: "--highlight-amber" },
  { id: "red", label: "Red", cssVariable: "--highlight-red" },
  { id: "green", label: "Green", cssVariable: "--highlight-green" },
  { id: "blue", label: "Blue", cssVariable: "--highlight-blue" },
  { id: "purple", label: "Purple", cssVariable: "--highlight-purple" },
  { id: "slate", label: "Slate", cssVariable: "--highlight-slate" },
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
