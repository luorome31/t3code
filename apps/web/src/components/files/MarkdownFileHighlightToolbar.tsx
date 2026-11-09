import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { EraserIcon, HighlighterIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  MAX_HIGHLIGHTS_PER_THREAD,
  MAX_HIGHLIGHT_TEXT_LENGTH,
  readThreadHighlights,
  sameHighlightSelector,
  sameHighlightSource,
  useHighlightStore,
  type ThreadHighlightSource,
} from "~/highlightStore";
import {
  captureViewportTextSelection,
  type AssistantTextSelector,
} from "~/lib/assistantTextSelection";
import {
  isSelectionRangeVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

export function MarkdownFileHighlightToolbar({
  viewport,
  threadRef,
  workspaceRoot,
  relativePath,
}: {
  readonly viewport: HTMLElement | null;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string;
  readonly relativePath: string;
}) {
  const [selection, setSelection] = useState<{
    selector: AssistantTextSelector;
    position: SelectionActionPoint;
    existingHighlightId: string | null;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const { environmentId, threadId } = threadRef;
  const threadKey = scopedThreadKey(threadRef);
  const source: ThreadHighlightSource = { kind: "markdown-file", workspaceRoot, relativePath };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the toolbar DOM node and clamps its position inside the window before paint
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selectionchange to track text selections in the rendered Markdown file
  useEffect(() => {
    if (!viewport) return;
    const fileSource: ThreadHighlightSource = {
      kind: "markdown-file",
      workspaceRoot,
      relativePath,
    };
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const captured = captureViewportTextSelection(viewport, window.getSelection());
      if (!captured) {
        clear();
        return;
      }
      const viewportRect = viewport.getBoundingClientRect();
      if (!isSelectionRangeVisible(captured.range, viewport)) {
        clear();
        return;
      }
      const existingHighlightId =
        readThreadHighlights({ environmentId, threadId }).find(
          (highlight) =>
            sameHighlightSource(highlight.source, fileSource) &&
            sameHighlightSelector(highlight.selector, captured.selector),
        )?.id ?? null;
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      setSelection({
        selector: captured.selector,
        existingHighlightId,
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? captured.range.getBoundingClientRect(),
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      const firstAction = toolbar.querySelector<HTMLButtonElement>("button:not(:disabled)");
      if (!firstAction) return;
      event.preventDefault();
      event.stopPropagation();
      firstAction.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [environmentId, relativePath, threadId, viewport, workspaceRoot]);

  if (!selection) return null;
  const highlightTooLong = selection.selector.text.length > MAX_HIGHLIGHT_TEXT_LENGTH;
  const highlightSupported =
    typeof CSS !== "undefined" && Boolean(CSS.highlights) && typeof Highlight !== "undefined";
  const hasExistingHighlight = selection.existingHighlightId !== null;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    dismiss();
  };
  const toggleHighlight = () => {
    if (highlightTooLong) return;
    const selectionThreadRef: ScopedThreadRef = { environmentId, threadId };
    if (scopedThreadKey(selectionThreadRef) !== threadKey) return;
    if (selection.existingHighlightId) {
      useHighlightStore
        .getState()
        .removeHighlights(selectionThreadRef, [selection.existingHighlightId]);
      clearSelection();
      return;
    }
    const result = useHighlightStore.getState().addHighlight(selectionThreadRef, {
      source,
      selector: selection.selector,
    });
    if (!result.ok) {
      toastManager.add({
        type: "warning",
        title:
          result.reason === "too_long"
            ? "Selection is too long to highlight"
            : result.reason === "limit"
              ? `Highlight limit reached (${MAX_HIGHLIGHTS_PER_THREAD} per thread). Remove a highlight to add another.`
              : "This text is already highlighted",
      });
      return;
    }
    clearSelection();
  };

  return createPortal(
    <div
      ref={toolbarRef}
      role="group"
      aria-label="Selection actions"
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] items-center gap-1"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <Button
        type="button"
        size="xs"
        variant="glass"
        disabled={highlightTooLong || !highlightSupported}
        aria-label={
          !highlightSupported
            ? "Highlights are not supported in this browser"
            : highlightTooLong
              ? `Selection is too long to highlight (maximum ${MAX_HIGHLIGHT_TEXT_LENGTH} characters)`
              : hasExistingHighlight
                ? "Remove highlight"
                : "Highlight selection"
        }
        onClick={toggleHighlight}
      >
        {hasExistingHighlight ? (
          <EraserIcon aria-hidden="true" className="size-3.5" />
        ) : (
          <HighlighterIcon aria-hidden="true" className="size-3.5" />
        )}
        {!highlightSupported
          ? "Unavailable"
          : hasExistingHighlight
            ? "Remove highlight"
            : highlightTooLong
              ? "Too long"
              : "Highlight"}
      </Button>
    </div>,
    document.body,
  );
}
