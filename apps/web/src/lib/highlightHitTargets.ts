import type { HighlightColor } from "./highlightColors";

/** One highlight record's resolved DOM range, kept from the paint pass for click hit tests. */
export interface HighlightHitTarget {
  readonly id: string;
  readonly color: HighlightColor;
  readonly range: Range;
  /** Paint priority of the record, matching the paint registry's scale; larger paints above. */
  readonly priority: number;
}

export interface HighlightHitContribution {
  readonly targets: readonly HighlightHitTarget[];
  /** Per-color paint priority over every record of the pane, resolved or not. */
  readonly priorityByColor: ReadonlyMap<HighlightColor, number>;
}

const CLICK_SLOP_PX = 1;
const contributions = new Map<object, HighlightHitContribution>();

export function registerHighlightHitTargets(
  owner: object,
  contribution: HighlightHitContribution,
): void {
  contributions.set(owner, contribution);
}

export function removeHighlightHitTargets(owner: object): void {
  contributions.delete(owner);
}

function containsPoint(
  target: HighlightHitTarget,
  x: number,
  y: number,
  clip?: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  },
): boolean {
  // Detached anchors (virtualized rows, switched threads) stop hit-testing rather than throw.
  if (!target.range.startContainer.isConnected) return false;
  // The range's line boxes are exactly the painted pixels, so a click lands in one of them.
  const rects = target.range.getClientRects();
  for (const rect of rects) {
    if (
      x >= rect.left - CLICK_SLOP_PX &&
      x <= rect.right + CLICK_SLOP_PX &&
      y >= rect.top - CLICK_SLOP_PX &&
      y <= rect.bottom + CLICK_SLOP_PX
    ) {
      if (clip === undefined) return true;
      return (
        rect.left < clip.right &&
        rect.right > clip.left &&
        rect.top < clip.bottom &&
        rect.bottom > clip.top
      );
    }
  }
  return false;
}

/**
 * The highlight actually painted on top at this viewport point: colors stack by the paint
 * registry's per-color priority, and the newest record breaks ties inside the winning color.
 * A clip keeps scrolled-away line boxes from catching pointers outside the visible pane.
 */
export function topmostHighlightHitAt(
  x: number,
  y: number,
  clip?: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  },
): HighlightHitTarget | null {
  const colorPriority = new Map<HighlightColor, number>();
  for (const contribution of contributions.values()) {
    for (const [color, priority] of contribution.priorityByColor) {
      colorPriority.set(color, Math.max(colorPriority.get(color) ?? 0, priority));
    }
  }
  let best: HighlightHitTarget | null = null;
  let bestColorPriority = 0;
  for (const contribution of contributions.values()) {
    for (const target of contribution.targets) {
      if (!containsPoint(target, x, y, clip)) continue;
      const priority = colorPriority.get(target.color) ?? 0;
      if (
        best !== null &&
        (priority < bestColorPriority ||
          (priority === bestColorPriority && target.priority <= best.priority))
      ) {
        continue;
      }
      best = target;
      bestColorPriority = priority;
    }
  }
  return best;
}
