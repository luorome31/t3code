import type { MessageOutlineHeading } from "../chat/messageOutline";

export const MARKDOWN_OUTLINE_DOCK_MIN_WIDTH = 640;
export const MARKDOWN_OUTLINE_FILTER_THRESHOLD = 8;
export const MARKDOWN_OUTLINE_HEADING_OFFSET = 20;
export const MARKDOWN_OUTLINE_SCROLLSPY_OFFSET = 32;
const MARKDOWN_OUTLINE_DEFAULT_MAX_DEPTH = 3;
const MARKDOWN_OUTLINE_MAX_VISUAL_DEPTH = 3;

export interface OutlineHeadingPosition {
  readonly index: number;
  readonly top: number;
}

export interface MarkdownOutlineLayout {
  readonly hasHeadings: boolean;
  readonly canDock: boolean;
  readonly usesDockedToggle: boolean;
  readonly dockedOpen: boolean;
  readonly canPinInPopover: boolean;
  readonly canUnpinInSidebar: boolean;
}

export interface VisibleOutlineHeadings {
  readonly topLevel: number;
  readonly visibleHeadings: readonly MessageOutlineHeading[];
  readonly hasDeeperHeadings: boolean;
  readonly hiddenCount: number;
}

/** Checks structural equality so DOM mutation observers skip redundant React state updates. */
export function sameOutlineHeadings(
  left: readonly MessageOutlineHeading[],
  right: readonly MessageOutlineHeading[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!;
    const b = right[index]!;
    if (a.index !== b.index || a.level !== b.level || a.text !== b.text) {
      return false;
    }
  }
  return true;
}

/** Normalizes the shallowest heading level in the document to zero visual indentation. */
export function resolveOutlineTopLevel(headings: readonly MessageOutlineHeading[]): number {
  if (headings.length === 0) return 1;
  let top = headings[0]!.level;
  for (let index = 1; index < headings.length; index++) {
    const level = headings[index]!.level;
    if (level < top) top = level;
  }
  return top;
}

/** Selects up to 3 relative levels by default, exposing deeper headings on demand. */
export function selectVisibleOutlineHeadings(
  headings: readonly MessageOutlineHeading[],
  showAllLevels: boolean,
): VisibleOutlineHeadings {
  const topLevel = resolveOutlineTopLevel(headings);
  const hasDeeperHeadings = headings.some(
    (heading) => heading.level - topLevel >= MARKDOWN_OUTLINE_DEFAULT_MAX_DEPTH,
  );
  const visibleHeadings =
    showAllLevels || !hasDeeperHeadings
      ? headings
      : headings.filter((heading) => heading.level - topLevel < MARKDOWN_OUTLINE_DEFAULT_MAX_DEPTH);
  return {
    topLevel,
    visibleHeadings,
    hasDeeperHeadings,
    hiddenCount: headings.length - visibleHeadings.length,
  };
}

/** Rolls up a hidden deep heading's ScrollSpy state to its nearest visible ancestor heading. */
export function resolveVisibleActiveHeadingIndex(
  visibleHeadings: readonly MessageOutlineHeading[],
  activeHeadingIndex: number | null,
): number | null {
  if (activeHeadingIndex === null || visibleHeadings.length === 0) return null;
  let resolved = visibleHeadings[0]!.index;
  for (const heading of visibleHeadings) {
    if (heading.index <= activeHeadingIndex) {
      resolved = heading.index;
    } else {
      break;
    }
  }
  return resolved;
}

/** Caps indentation depth so deeply nested AI headings never crush outline labels. */
export function resolveVisualOutlineDepth(level: number, topLevel: number): number {
  return Math.min(Math.max(0, level - topLevel), MARKDOWN_OUTLINE_MAX_VISUAL_DEPTH);
}

/** Filters headings case-insensitively by trimmed query, keeping the original array when blank. */
export function filterOutlineHeadings(
  headings: readonly MessageOutlineHeading[],
  query: string,
): readonly MessageOutlineHeading[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return headings;
  return headings.filter((heading) => heading.text.toLowerCase().includes(normalized));
}

/** Resolves the currently active heading index from heading positions relative to the viewport top. */
export function resolveActiveHeadingIndex(input: {
  readonly headingTops: readonly OutlineHeadingPosition[];
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly activationOffset?: number;
}): number | null {
  const { headingTops, scrollTop, clientHeight, scrollHeight } = input;
  if (headingTops.length === 0) return null;
  if (scrollTop <= 1) return headingTops[0]!.index;

  const activationOffset = input.activationOffset ?? MARKDOWN_OUTLINE_SCROLLSPY_OFFSET;
  let active = headingTops[0]!.index;
  for (const heading of headingTops) {
    if (heading.top <= activationOffset) {
      active = heading.index;
    } else {
      break;
    }
  }

  if (scrollHeight > clientHeight + 1 && scrollTop + clientHeight >= scrollHeight - 2) {
    return headingTops[headingTops.length - 1]!.index;
  }

  return active;
}

/** Computes whether the outline renders as a Typora-style left sidebar or a floating popover. */
export function resolveMarkdownOutlineLayout(input: {
  readonly enabled: boolean;
  readonly headingCount: number;
  readonly surfaceWidth: number;
  readonly maximized: boolean;
  readonly maximizedOpen: boolean;
  readonly pinned: boolean;
}): MarkdownOutlineLayout {
  const hasHeadings = input.enabled && input.headingCount > 0;
  const canDock = hasHeadings && input.surfaceWidth >= MARKDOWN_OUTLINE_DOCK_MIN_WIDTH;
  const usesDockedToggle = canDock && input.maximized;
  const dockedOpen = canDock && (input.maximized ? input.maximizedOpen : input.pinned);
  const canPinInPopover = canDock && !input.maximized && !input.pinned;
  const canUnpinInSidebar = dockedOpen && !input.maximized;
  return {
    hasHeadings,
    canDock,
    usesDockedToggle,
    dockedOpen,
    canPinInPopover,
    canUnpinInSidebar,
  };
}
