import * as Schema from "effect/Schema";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { isMacPlatform } from "~/lib/utils";
import {
  outlineHeadingElements,
  readMarkdownOutline,
  type MessageOutlineHeading,
} from "../chat/messageOutline";
import {
  MARKDOWN_OUTLINE_HEADING_OFFSET,
  MARKDOWN_OUTLINE_SCROLLSPY_OFFSET,
  resolveActiveHeadingIndex,
  resolveMarkdownOutlineLayout,
  sameOutlineHeadings,
  type MarkdownOutlineLayout,
} from "./markdownOutline.logic";

const MAXIMIZED_OPEN_STORAGE_KEY = "t3code.markdownOutlineMaximizedOpen";
const PINNED_STORAGE_KEY = "t3code.markdownOutlinePinned";
const EMPTY_HEADINGS: readonly MessageOutlineHeading[] = [];
const JUMP_HIGHLIGHT_CLASS = "markdown-outline-jump-target";
const JUMP_SCROLL_SETTLE_MS = 800;

const MODAL_POPUP_SELECTOR = ["dialog-popup", "alert-dialog-popup", "command-dialog-popup"]
  .map((slot) => `[data-slot="${slot}"]:is([data-open],[data-ending-style])`)
  .join(",");

export interface MarkdownOutlineController {
  readonly documentKey: string;
  readonly headings: readonly MessageOutlineHeading[];
  readonly activeHeadingIndex: number | null;
  readonly showAllLevels: boolean;
  readonly toggleShowAllLevels: () => void;
  readonly layout: MarkdownOutlineLayout;
  readonly popoverOpen: boolean;
  readonly setPopoverOpen: (open: boolean) => void;
  readonly toggleOutline: () => void;
  readonly pinOutline: () => void;
  readonly unpinOutline: () => void;
  readonly hideDockedOutline: () => void;
  readonly jumpToHeading: (index: number) => void;
  readonly shortcutLabel: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Coordinates heading extraction, ScrollSpy tracking, Typora-style left docking on wide/maximized
 * panels, floating popover fallback on narrow panels, and the `Mod+Alt+O` toggle shortcut.
 */
export function useMarkdownOutline(input: {
  readonly enabled: boolean;
  readonly documentKey: string;
  readonly maximized: boolean;
  readonly surfaceContainer: HTMLDivElement | null;
  readonly markdownContainer: HTMLDivElement | null;
}): MarkdownOutlineController {
  const { enabled, documentKey, maximized, surfaceContainer, markdownContainer } = input;
  const [maximizedOpen, setMaximizedOpen] = useLocalStorage(
    MAXIMIZED_OPEN_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  const [pinned, setPinned] = useLocalStorage(PINNED_STORAGE_KEY, false, Schema.Boolean);
  const [headings, setHeadings] = useState<readonly MessageOutlineHeading[]>(EMPTY_HEADINGS);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [activeState, setActiveState] = useState<{
    readonly documentKey: string;
    readonly index: number | null;
  }>({ documentKey, index: null });
  const [popoverState, setPopoverState] = useState<{
    readonly documentKey: string;
    readonly open: boolean;
  }>({ documentKey, open: false });
  const [depthState, setDepthState] = useState<{
    readonly documentKey: string;
    readonly showAllLevels: boolean;
  }>({ documentKey, showAllLevels: false });

  const pendingJumpRef = useRef<{
    readonly index: number;
    readonly targetTop: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const visibleHeadings = enabled && markdownContainer !== null ? headings : EMPTY_HEADINGS;
  const layout = resolveMarkdownOutlineLayout({
    enabled,
    headingCount: visibleHeadings.length,
    surfaceWidth,
    maximized,
    maximizedOpen,
    pinned,
  });

  const activeHeadingIndex =
    activeState.documentKey === documentKey
      ? activeState.index
      : visibleHeadings.length > 0
        ? visibleHeadings[0]!.index
        : null;

  const setActiveHeadingIndex = useStableCallback((index: number | null) => {
    setActiveState((previous) =>
      previous.documentKey === documentKey && previous.index === index
        ? previous
        : { documentKey, index },
    );
  });

  const popoverOpen =
    layout.hasHeadings &&
    !layout.dockedOpen &&
    popoverState.documentKey === documentKey &&
    popoverState.open;

  const setPopoverOpen = useStableCallback((open: boolean) => {
    setPopoverState({ documentKey, open });
  });

  const showAllLevels = depthState.documentKey === documentKey ? depthState.showAllLevels : false;
  const toggleShowAllLevels = useStableCallback(() => {
    setDepthState({ documentKey, showAllLevels: !showAllLevels });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes container width so docking degrades cleanly to a popover when narrowed
  useLayoutEffect(() => {
    if (!enabled || !surfaceContainer) return;
    const measure = () => {
      const nextWidth = Math.round(surfaceContainer.clientWidth);
      setSurfaceWidth((previous) => (previous === nextWidth ? previous : nextWidth));
    };
    measure();
    return observeResize(surfaceContainer, measure);
  }, [enabled, surfaceContainer]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- extracts rendered headings from the Markdown DOM and stays synced across async block renders
  useLayoutEffect(() => {
    if (!enabled || !markdownContainer) return;
    let frame = 0;
    const syncHeadings = () => {
      const markdownRoot = markdownContainer.querySelector<HTMLElement>(".chat-markdown");
      const next = markdownRoot ? readMarkdownOutline(markdownRoot) : EMPTY_HEADINGS;
      setHeadings((previous) => (sameOutlineHeadings(previous, next) ? previous : next));
    };
    syncHeadings();
    const observer = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncHeadings();
      });
    });
    observer.observe(markdownContainer, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [enabled, markdownContainer]);

  const viewport =
    enabled && markdownContainer
      ? (markdownContainer.closest<HTMLElement>('[data-slot="scroll-area-viewport"]') ??
        markdownContainer)
      : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the active section as the Markdown ScrollArea scrolls or resizes
  useEffect(() => {
    if (!enabled || !markdownContainer || !viewport || visibleHeadings.length === 0) return;

    const clearPendingJump = () => {
      const pending = pendingJumpRef.current;
      if (!pending) return;
      if (pending.timer !== null) clearTimeout(pending.timer);
      pendingJumpRef.current = null;
    };

    const updateActiveHeading = () => {
      const markdownRoot = markdownContainer.querySelector<HTMLElement>(".chat-markdown");
      if (!markdownRoot) return;
      const elements = outlineHeadingElements(markdownRoot);
      if (elements.length === 0) {
        setActiveHeadingIndex(null);
        return;
      }

      const pending = pendingJumpRef.current;
      if (pending !== null) {
        if (Math.abs(viewport.scrollTop - pending.targetTop) <= 2) {
          clearPendingJump();
        } else {
          return;
        }
      }

      const viewportRect = viewport.getBoundingClientRect();
      const headingTops = elements.map((heading, index) => ({
        index,
        top: heading.getBoundingClientRect().top - viewportRect.top,
      }));
      const nextIndex = resolveActiveHeadingIndex({
        headingTops,
        scrollTop: viewport.scrollTop,
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        activationOffset: MARKDOWN_OUTLINE_SCROLLSPY_OFFSET,
      });
      setActiveHeadingIndex(nextIndex);
    };

    updateActiveHeading();
    let frame = 0;
    const scheduleUpdate = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateActiveHeading();
      });
    };
    const onScrollEnd = () => {
      clearPendingJump();
      updateActiveHeading();
    };

    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    viewport.addEventListener("scrollend", onScrollEnd);
    viewport.addEventListener("wheel", clearPendingJump, { passive: true });
    viewport.addEventListener("pointerdown", clearPendingJump);
    viewport.addEventListener("touchstart", clearPendingJump, { passive: true });
    const stopResize = observeResize(viewport, updateActiveHeading);
    return () => {
      clearPendingJump();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", scheduleUpdate);
      viewport.removeEventListener("scrollend", onScrollEnd);
      viewport.removeEventListener("wheel", clearPendingJump);
      viewport.removeEventListener("pointerdown", clearPendingJump);
      viewport.removeEventListener("touchstart", clearPendingJump);
      stopResize();
    };
  }, [enabled, markdownContainer, setActiveHeadingIndex, viewport, visibleHeadings]);

  const jumpToHeading = useStableCallback((index: number) => {
    if (!markdownContainer || !viewport) return;
    const markdownRoot = markdownContainer.querySelector<HTMLElement>(".chat-markdown");
    const heading = markdownRoot ? outlineHeadingElements(markdownRoot)[index] : undefined;
    if (!heading) return;

    let ancestor = heading.parentElement;
    while (ancestor && ancestor !== markdownRoot) {
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
        ancestor.open = true;
      }
      ancestor = ancestor.parentElement;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const targetTop = Math.max(
      0,
      Math.min(
        maxScrollTop,
        viewport.scrollTop + headingRect.top - viewportRect.top - MARKDOWN_OUTLINE_HEADING_OFFSET,
      ),
    );

    if (pendingJumpRef.current?.timer !== null && pendingJumpRef.current?.timer !== undefined) {
      clearTimeout(pendingJumpRef.current.timer);
    }
    const reducedMotion = prefersReducedMotion();
    if (reducedMotion || Math.abs(viewport.scrollTop - targetTop) <= 2) {
      pendingJumpRef.current = null;
    } else {
      const pending = {
        index,
        targetTop,
        timer: setTimeout(() => {
          if (pendingJumpRef.current === pending) {
            pendingJumpRef.current = null;
          }
        }, JUMP_SCROLL_SETTLE_MS),
      };
      pendingJumpRef.current = pending;
    }

    setActiveHeadingIndex(index);
    viewport.scrollTo({
      top: targetTop,
      behavior: reducedMotion ? "auto" : "smooth",
    });

    heading.classList.remove(JUMP_HIGHLIGHT_CLASS);
    void heading.offsetWidth;
    heading.classList.add(JUMP_HIGHLIGHT_CLASS);
    heading.addEventListener(
      "animationend",
      () => {
        heading.classList.remove(JUMP_HIGHLIGHT_CLASS);
      },
      { once: true },
    );
  });

  const toggleOutline = useStableCallback(() => {
    if (!layout.hasHeadings) return;
    if (layout.usesDockedToggle) {
      setMaximizedOpen((current) => !current);
      return;
    }
    if (layout.dockedOpen) {
      setPinned(false);
      return;
    }
    setPopoverOpen(!popoverOpen);
  });

  const pinOutline = useStableCallback(() => {
    if (!layout.canDock) return;
    setPopoverOpen(false);
    setPinned(true);
  });

  const unpinOutline = useStableCallback(() => {
    setPinned(false);
  });

  const hideDockedOutline = useStableCallback(() => {
    setMaximizedOpen(false);
  });

  const mac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  const shortcutLabel = mac ? "⌘⌥O" : "Ctrl+Alt+O";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds Mod+Alt+O to toggle the active visible Markdown outline
  useEffect(() => {
    if (!enabled || !layout.hasHeadings || !surfaceContainer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.code !== "KeyO" || !event.altKey || event.shiftKey) return;
      const matchesModifier = mac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!matchesModifier) return;
      if (surfaceContainer.getClientRects().length === 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest(".xterm, [data-terminal-surface]")
      ) {
        return;
      }
      const openModal = document.querySelector(MODAL_POPUP_SELECTOR);
      if (openModal && !openModal.contains(surfaceContainer)) return;

      event.preventDefault();
      event.stopPropagation();
      toggleOutline();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, layout.hasHeadings, mac, surfaceContainer, toggleOutline]);

  return {
    documentKey,
    headings: visibleHeadings,
    activeHeadingIndex,
    showAllLevels,
    toggleShowAllLevels,
    layout,
    popoverOpen,
    setPopoverOpen,
    toggleOutline,
    pinOutline,
    unpinOutline,
    hideDockedOutline,
    jumpToHeading,
    shortcutLabel,
  };
}
