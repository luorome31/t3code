import { setHighlightPriority } from "./cssHighlights";
import { HIGHLIGHT_COLORS, highlightRegistryName, type HighlightColor } from "./highlightColors";

export interface HighlightContribution {
  readonly rangesByColor: ReadonlyMap<HighlightColor, readonly Range[]>;
  readonly priorityByColor: ReadonlyMap<HighlightColor, number>;
}

const contributions = new Map<object, HighlightContribution>();

function paintContributions(): void {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
  const registry = CSS.highlights;
  const rangesByColor = new Map<HighlightColor, Range[]>();
  const priorityByColor = new Map<HighlightColor, number>();
  for (const contribution of contributions.values()) {
    for (const [color, ranges] of contribution.rangesByColor) {
      const merged = rangesByColor.get(color);
      if (merged) merged.push(...ranges);
      else rangesByColor.set(color, [...ranges]);
    }
    for (const [color, priority] of contribution.priorityByColor) {
      priorityByColor.set(color, Math.max(priorityByColor.get(color) ?? 0, priority));
    }
  }
  for (const color of HIGHLIGHT_COLORS) {
    if ((rangesByColor.get(color.id)?.length ?? 0) === 0) {
      registry.delete(highlightRegistryName(color.id));
    }
  }
  const ordered = [...HIGHLIGHT_COLORS].sort(
    (left, right) => (priorityByColor.get(left.id) ?? 0) - (priorityByColor.get(right.id) ?? 0),
  );
  for (const color of ordered) {
    const ranges = rangesByColor.get(color.id);
    if (ranges === undefined || ranges.length === 0) continue;
    const name = highlightRegistryName(color.id);
    const highlight = new Highlight(...ranges);
    setHighlightPriority(highlight, priorityByColor.get(color.id) ?? 1);
    registry.delete(name);
    registry.set(name, highlight);
  }
}

export function registerHighlightContribution(
  owner: object,
  contribution: HighlightContribution,
): void {
  contributions.set(owner, contribution);
  paintContributions();
}

export function removeHighlightContribution(owner: object): void {
  if (!contributions.delete(owner)) return;
  paintContributions();
}
