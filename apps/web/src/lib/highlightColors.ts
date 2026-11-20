import { msg } from "gt-react";

const HIGHLIGHT_COLOR_IDS = ["amber", "red", "green", "blue", "purple", "slate"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLOR_IDS)[number];

export interface HighlightColorDefinition {
  readonly id: HighlightColor;
  readonly label: string;
  readonly cssVariable: `--highlight-${HighlightColor}`;
}

export const HIGHLIGHT_COLORS: readonly HighlightColorDefinition[] = [
  { id: "amber", label: msg("Amber"), cssVariable: "--highlight-amber" },
  { id: "red", label: msg("Red"), cssVariable: "--highlight-red" },
  { id: "green", label: msg("Green"), cssVariable: "--highlight-green" },
  { id: "blue", label: msg("Blue"), cssVariable: "--highlight-blue" },
  { id: "purple", label: msg("Purple"), cssVariable: "--highlight-purple" },
  { id: "slate", label: msg("Slate"), cssVariable: "--highlight-slate" },
];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "amber";

export function highlightColorDefinition(color: HighlightColor): HighlightColorDefinition {
  return HIGHLIGHT_COLORS.find((entry) => entry.id === color) ?? HIGHLIGHT_COLORS[0]!;
}

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && (HIGHLIGHT_COLOR_IDS as readonly string[]).includes(value);
}

export function highlightRegistryName(
  color: HighlightColor,
): `t3-assistant-highlight-${HighlightColor}` {
  return `t3-assistant-highlight-${color}`;
}
