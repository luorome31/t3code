import { HIGHLIGHT_COLORS, type HighlightColor } from "./highlightColors";

/** One highlight record's resolved DOM range, kept from the paint pass for click hit tests. */
export interface HighlightHitTarget {
  readonly id: string;
  readonly color: HighlightColor;
  readonly range: Range;
  /** Paint priority of the record, matching the paint registry's scale; larger paints above. */
  readonly priority: number;
}

export interface HighlightHitContribution {
  readonly container: HTMLElement;
  readonly targets: readonly HighlightHitTarget[];
  /** Per-color paint priority over every record of the pane, resolved or not. */
  readonly priorityByColor: ReadonlyMap<HighlightColor, number>;
}

const INTERACTIVE_SELECTOR =
  "a, button, input, textarea, select, label, [role=button], [contenteditable=true], img, video, audio, canvas, svg";
const CLICK_SLOP_PX = 1;
const colorPaintOrder = new Map(HIGHLIGHT_COLORS.map((color, index) => [color.id, index]));
const contributions = new Map<object, HighlightHitContribution>();
const listeners = new Set<() => void>();

export function subscribeToHighlightHitTargets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readHighlightHitTargets(container: HTMLElement): HighlightHitTarget[] {
  return Array.from(contributions.values()).flatMap((contribution) =>
    contribution.container === container ? contribution.targets : [],
  );
}

export function registerHighlightHitTargets(
  owner: object,
  contribution: HighlightHitContribution,
): void {
  contributions.set(owner, contribution);
  for (const listener of listeners) listener();
}

export function removeHighlightHitTargets(owner: object): void {
  if (contributions.delete(owner)) for (const listener of listeners) listener();
}

function rectsContainPoint(rects: DOMRectList, x: number, y: number): boolean {
  for (const rect of rects) {
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left - CLICK_SLOP_PX &&
      x <= rect.right + CLICK_SLOP_PX &&
      y >= rect.top - CLICK_SLOP_PX &&
      y <= rect.bottom + CLICK_SLOP_PX
    ) {
      return true;
    }
  }
  return false;
}

export function topmostHighlightHitAt(
  viewport: HTMLElement,
  x: number,
  y: number,
): HighlightHitTarget | null {
  const document = viewport.ownerDocument;
  const element = document.elementFromPoint(x, y);
  if (!element || !viewport.contains(element) || element.closest(INTERACTIVE_SELECTOR)) return null;
  const math = element.closest("[data-markdown-math]");
  const textNodes = Array.from(element.childNodes).filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE,
  );
  if (!math && textNodes.length === 0) return null;

  // A multi-block Range also returns element boxes, including space past the end of the text.
  const textRange = document.createRange();
  const containsPoint = (range: Range) => {
    if (!viewport.contains(range.commonAncestorContainer) || !range.intersectsNode(element)) {
      return false;
    }
    if (math) return range.intersectsNode(math) && rectsContainPoint(math.getClientRects(), x, y);
    for (const node of textNodes) {
      if (!range.intersectsNode(node)) continue;
      textRange.setStart(node, node === range.startContainer ? range.startOffset : 0);
      textRange.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
      if (!textRange.collapsed && rectsContainPoint(textRange.getClientRects(), x, y)) return true;
    }
    return false;
  };

  const colorPriority = new Map<HighlightColor, number>();
  for (const contribution of contributions.values()) {
    for (const [color, priority] of contribution.priorityByColor) {
      colorPriority.set(color, Math.max(colorPriority.get(color) ?? 0, priority));
    }
  }
  let best: HighlightHitTarget | null = null;
  let bestColorPriority = 0;
  let bestColorOrder = 0;
  for (const contribution of contributions.values()) {
    for (const target of contribution.targets) {
      if (!containsPoint(target.range)) continue;
      const priority = colorPriority.get(target.color) ?? 0;
      const order = colorPaintOrder.get(target.color)!;
      const layerComparison = priority - bestColorPriority || order - bestColorOrder;
      if (
        best !== null &&
        (layerComparison < 0 || (layerComparison === 0 && target.priority < best.priority))
      ) {
        continue;
      }
      best = target;
      bestColorPriority = priority;
      bestColorOrder = order;
    }
  }
  return best;
}
