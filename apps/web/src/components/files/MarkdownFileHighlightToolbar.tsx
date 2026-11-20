import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { QuoteIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  MAX_HIGHLIGHTS_PER_THREAD,
  MAX_HIGHLIGHT_TEXT_LENGTH,
  readThreadHighlights,
  sameHighlightSelector,
  sameHighlightSource,
  useHighlightStore,
  type HighlightColor,
  type MarkdownFileHighlightExcerpt,
  type ThreadHighlight,
  type ThreadHighlightSource,
} from "~/highlightStore";
import { HighlightToolbarActions } from "../highlights/HighlightToolbarActions";
import {
  captureViewportTextSelection,
  type AssistantTextSelector,
} from "~/lib/assistantTextSelection";
import { topmostHighlightHitAt } from "~/lib/highlightHitTargets";
import { observeResize } from "~/lib/observeResize";
import {
  isSelectionRangeVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

const INTERACTIVE_SELECTOR =
  "a, button, input, textarea, select, label, [role=button], [contenteditable=true], img, video, audio, canvas, svg";

interface ClickedHighlight {
  readonly highlight: ThreadHighlight;
  readonly position: SelectionActionPoint;
}

export function MarkdownFileHighlightToolbar({
  viewport,
  threadRef,
  workspaceRoot,
  relativePath,
  onCite,
}: {
  readonly viewport: HTMLElement | null;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly onCite?: ((excerpt: MarkdownFileHighlightExcerpt) => boolean) | undefined;
}) {
  const [selection, setSelection] = useState<{
    selector: AssistantTextSelector;
    position: SelectionActionPoint;
    existingHighlightId: string | null;
  } | null>(null);
  const [clickedHighlight, setClickedHighlight] = useState<ClickedHighlight | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const { environmentId, threadId } = threadRef;
  const threadKey = scopedThreadKey(threadRef);
  const source: ThreadHighlightSource = { kind: "markdown-file", workspaceRoot, relativePath };
  const position = selection?.position ?? clickedHighlight?.position ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the toolbar DOM node and clamps its position inside the window before paint, and re-clamps when its own width changes (the thread palette expands inline)
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || position === null) return;
    const clamp = () => {
      const rect = toolbar.getBoundingClientRect();
      toolbar.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
      toolbar.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
    };
    clamp();
    return observeResize(toolbar, clamp);
  }, [position]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selectionchange to track text selections in the rendered Markdown file
  useEffect(() => {
    if (!viewport) return;
    // The effect owns its source record so its closures never depend on render-scope identity.
    const fileSource: ThreadHighlightSource = {
      kind: "markdown-file",
      workspaceRoot,
      relativePath,
    };
    const clear = () => {
      setSelection(null);
      setClickedHighlight(null);
    };
    // A plain click has no selection of its own, so it acts on the painted highlight under it.
    const clickHighlight = (pointer: SelectionActionPoint): ThreadHighlight | null => {
      // Links and controls keep their own click behavior; the toolbar never claims it.
      if (
        viewport.ownerDocument.elementFromPoint(pointer.x, pointer.y)?.closest(INTERACTIVE_SELECTOR)
      ) {
        return null;
      }
      const hit = topmostHighlightHitAt(pointer.x, pointer.y, viewport.getBoundingClientRect());
      if (hit === null) return null;
      return (
        readThreadHighlights({ environmentId, threadId }).find(
          (candidate) =>
            candidate.id === hit.id && sameHighlightSource(candidate.source, fileSource),
        ) ?? null
      );
    };
    const update = (pointer: SelectionActionPoint | null) => {
      const captured = captureViewportTextSelection(viewport, window.getSelection());
      if (!captured) {
        if (pointer !== null) {
          const nativeSelection = window.getSelection();
          if (nativeSelection === null || nativeSelection.isCollapsed) {
            const highlight = clickHighlight(pointer);
            if (highlight !== null) {
              setSelection(null);
              setClickedHighlight({
                highlight,
                position: resolveSelectionActionPosition({
                  bounds: viewport.getBoundingClientRect(),
                  selectionRect: null,
                  pointer,
                  viewport: { width: window.innerWidth, height: window.innerHeight },
                }),
              });
              return;
            }
          }
        }
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
      setClickedHighlight(null);
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

  if (!selection && !clickedHighlight) return null;
  const highlightTooLong =
    selection !== null && selection.selector.text.length > MAX_HIGHLIGHT_TEXT_LENGTH;
  const highlightSupported =
    typeof CSS !== "undefined" && Boolean(CSS.highlights) && typeof Highlight !== "undefined";
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
    setClickedHighlight(null);
  };
  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    dismiss();
  };
  if (selection !== null) {
    const removeHighlight = () => {
      if (!selection.existingHighlightId) return;
      const selectionThreadRef: ScopedThreadRef = { environmentId, threadId };
      useHighlightStore
        .getState()
        .removeHighlights(selectionThreadRef, [selection.existingHighlightId]);
      clearSelection();
    };
    const addHighlight = (color: HighlightColor) => {
      if (highlightTooLong) return;
      const selectionThreadRef: ScopedThreadRef = { environmentId, threadId };
      if (scopedThreadKey(selectionThreadRef) !== threadKey) return;
      const result = useHighlightStore.getState().addHighlight(selectionThreadRef, {
        source,
        selector: selection.selector,
        color,
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
        <HighlightToolbarActions
          threadRef={threadRef}
          supported={highlightSupported}
          tooLong={highlightTooLong}
          hasExistingHighlight={selection.existingHighlightId !== null}
          onAdd={addHighlight}
          onRemove={removeHighlight}
        />
      </div>,
      document.body,
    );
  }
  const clicked = clickedHighlight!;
  const citeClickedHighlight = () => {
    const highlight = clicked.highlight;
    if (onCite === undefined || highlight.source.kind !== "markdown-file") return false;
    const inserted = onCite({
      workspaceRoot: highlight.source.workspaceRoot,
      relativePath: highlight.source.relativePath,
      text: highlight.selector.text,
    });
    if (!inserted) return false;
    dismiss();
    return true;
  };
  const removeClickedHighlight = () => {
    useHighlightStore.getState().removeHighlights(threadRef, [clicked.highlight.id]);
    dismiss();
  };
  return createPortal(
    <div
      ref={toolbarRef}
      role="group"
      aria-label="Highlight actions"
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] items-center gap-1"
      style={{ left: clicked.position.x, top: clicked.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      {onCite !== undefined ? (
        <Button
          type="button"
          size="xs"
          variant="glass"
          aria-label="Cite highlight in composer"
          onClick={citeClickedHighlight}
        >
          <QuoteIcon aria-hidden="true" className="size-3.5" />
          Cite
        </Button>
      ) : null}
      <HighlightToolbarActions
        threadRef={threadRef}
        supported={highlightSupported}
        tooLong={false}
        hasExistingHighlight={true}
        onAdd={() => undefined}
        onRemove={removeClickedHighlight}
      />
    </div>,
    document.body,
  );
}
