import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
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
  type ThreadHighlightSource,
} from "~/highlightStore";
import { HighlightContextActions } from "../highlights/HighlightContextActions";
import { HighlightNoteMarkers } from "../highlights/HighlightNoteMarkers";
import {
  HighlightNoteSurface,
  highlightNoteTarget,
  useHighlightNoteGuard,
  type HighlightNoteTarget,
} from "../highlights/HighlightNoteSurface";
import { HighlightToolbarActions } from "../highlights/HighlightToolbarActions";
import {
  captureViewportTextSelection,
  type AssistantTextSelector,
} from "~/lib/assistantTextSelection";
import { type HighlightInsert, markdownHighlightExcerpt } from "~/lib/highlightCitation";
import { topmostHighlightHitAt } from "~/lib/highlightHitTargets";
import { observeResize } from "~/lib/observeResize";
import {
  isSelectionRangeVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { toastManager } from "../ui/toast";

interface ClickedHighlight {
  readonly id: string;
  readonly position: SelectionActionPoint;
}

export function MarkdownFileHighlightToolbar({
  viewport,
  container = viewport,
  threadRef,
  workspaceRoot,
  relativePath,
  onCite,
}: {
  readonly viewport: HTMLElement | null;
  readonly container?: HTMLElement | null;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly onCite?: HighlightInsert<MarkdownFileHighlightExcerpt> | undefined;
}) {
  const gt = useGT();
  const [selection, setSelection] = useState<{
    selector: AssistantTextSelector;
    position: SelectionActionPoint;
    existingHighlightId: string | null;
  } | null>(null);
  const [clickedHighlight, setClickedHighlight] = useState<ClickedHighlight | null>(null);
  const noteGuard = useHighlightNoteGuard();
  const [noteTarget, setNoteTarget] = useState<HighlightNoteTarget | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const { environmentId, threadId } = threadRef;
  const threadKey = scopedThreadKey(threadRef);
  const activeId = noteTarget?.id ?? clickedHighlight?.id;
  const activeHighlight = useHighlightStore((state) =>
    activeId === undefined
      ? undefined
      : state.byThreadKey[threadKey]?.find((highlight) => highlight.id === activeId),
  );
  const source: ThreadHighlightSource = { kind: "markdown-file", workspaceRoot, relativePath };
  const position = selection?.position ?? null;

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
    const clickHighlight = (pointer: SelectionActionPoint): string | null => {
      const hit = topmostHighlightHitAt(viewport, pointer.x, pointer.y);
      if (hit === null) return null;
      return (
        readThreadHighlights({ environmentId, threadId }).find(
          (candidate) =>
            candidate.id === hit.id && sameHighlightSource(candidate.source, fileSource),
        )?.id ?? null
      );
    };
    const update = (
      pointer: SelectionActionPoint | null,
      clicked: ReturnType<typeof clickHighlight>,
    ) => {
      const nativeSelection = window.getSelection();
      const captured = captureViewportTextSelection(viewport, nativeSelection);
      if (!captured) {
        if (
          pointer !== null &&
          clicked !== null &&
          (nativeSelection === null || nativeSelection.isCollapsed)
        ) {
          setSelection(null);
          setClickedHighlight({
            id: clicked,
            position: resolveSelectionActionPosition({
              bounds: viewport.getBoundingClientRect(),
              selectionRect: null,
              pointer,
              viewport: { width: window.innerWidth, height: window.innerHeight },
            }),
          });
          return;
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
      resolveClickTarget: clickHighlight,
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
  type Selection = NonNullable<typeof selection>;
  const renderSelection = (selection: Selection) => {
    const highlightTooLong = selection.selector.text.length > MAX_HIGHLIGHT_TEXT_LENGTH;
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
              ? gt("Selection is too long to highlight")
              : result.reason === "limit"
                ? gt(
                    "Highlight limit reached ({count} per thread). Remove a highlight to add another.",
                    { count: MAX_HIGHLIGHTS_PER_THREAD },
                  )
                : result.reason === "storage"
                  ? gt("Could not save this highlight")
                  : gt("This text is already highlighted"),
        });
        return;
      }
      clearSelection();
    };

    return createPortal(
      <div
        ref={toolbarRef}
        role="group"
        aria-label={gt("Selection actions")}
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
  };
  const openNotes = (id: string, trigger: HTMLElement) => {
    if (noteTarget?.id === id || !noteGuard.canLeave()) return;
    dismiss();
    setNoteTarget(highlightNoteTarget(id, trigger));
  };
  const renderClickedHighlight = () => {
    const clicked = clickedHighlight;
    if (!clicked || !activeHighlight || !viewport) return null;
    const cite = () => {
      const excerpt = markdownHighlightExcerpt(activeHighlight);
      if (!excerpt || !onCite?.(excerpt)) return false;
      dismiss();
      return true;
    };
    return (
      <HighlightContextActions
        key={clicked.id}
        highlight={activeHighlight}
        threadRef={threadRef}
        position={clicked.position}
        viewport={viewport}
        toolbarRef={toolbarRef}
        onCite={onCite ? cite : undefined}
        onNotes={(trigger) => openNotes(clicked.id, trigger)}
        onRemove={() => {
          useHighlightStore.getState().removeHighlights(threadRef, [clicked.id]);
          dismiss();
        }}
        onDismiss={dismiss}
      />
    );
  };

  return (
    <>
      <HighlightNoteMarkers
        container={container}
        viewport={viewport}
        threadRef={threadRef}
        onOpen={openNotes}
      />
      {noteTarget && activeHighlight ? (
        <HighlightNoteSurface
          key={noteTarget.id}
          threadRef={threadRef}
          highlight={activeHighlight}
          target={noteTarget}
          noteGuard={noteGuard}
          onClose={() => setNoteTarget(null)}
          onInsert={
            onCite
              ? (highlight, note) => {
                  const excerpt = markdownHighlightExcerpt(highlight, note.text);
                  return excerpt !== null && onCite(excerpt, "chat-draft");
                }
              : undefined
          }
        />
      ) : selection ? (
        renderSelection(selection)
      ) : (
        renderClickedHighlight()
      )}
    </>
  );
}
