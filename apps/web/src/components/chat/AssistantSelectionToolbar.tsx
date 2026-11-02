import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { EraserIcon, HighlighterIcon, QuoteIcon } from "lucide-react";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  captureAssistantTextSelection,
  resolveAssistantCitationRange,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import {
  MAX_HIGHLIGHT_TEXT_LENGTH,
  readThreadHighlights,
  useHighlightStore,
} from "~/highlightStore";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { BackgroundThreadContext } from "./backgroundThread";

function rangesEqual(left: Range, right: Range): boolean {
  return (
    left.compareBoundaryPoints(Range.START_TO_START, right) === 0 &&
    left.compareBoundaryPoints(Range.END_TO_END, right) === 0
  );
}

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
}) {
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    sourceAnchor: AssistantCitationSourceAnchor;
    existingHighlightId: string | null;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const backgroundThread = use(BackgroundThreadContext);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the toolbar DOM node and clamps its position inside the window before paint
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selectionchange and keydown to track text selections in the viewport
  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (!isSelectionRectVisible(rect, [viewportRect])) {
        clear();
        return;
      }
      // A selection can cross blocks with different clipping ancestors.
      const common = captured.range.commonAncestorContainer;
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
      let visible = false;
      for (; node && !visible; node = walker.nextNode()) {
        if (!captured.range.intersectsNode(node)) continue;
        if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none")
          continue;
        const fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (node === captured.range.startContainer) {
          fragment.setStart(node, captured.range.startOffset);
        }
        if (node === captured.range.endContainer) {
          fragment.setEnd(node, captured.range.endOffset);
        }
        if (!fragment.toString().trim()) continue;
        const lines = Array.from(fragment.getClientRects());
        if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
        const clips: Pick<DOMRect, "left" | "right" | "top" | "bottom">[] = [viewportRect];
        for (
          let element = node.parentElement;
          element && element !== viewport;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          const clipX = style.overflowX !== "visible";
          const clipY = style.overflowY !== "visible";
          if (!clipX && !clipY) continue;
          const bounds = element.getBoundingClientRect();
          const left = bounds.left + element.clientLeft;
          const top = bounds.top + element.clientTop;
          clips.push({
            left: clipX ? left : -Infinity,
            right: clipX ? left + element.clientWidth : Infinity,
            top: clipY ? top : -Infinity,
            bottom: clipY ? top + element.clientHeight : Infinity,
          });
        }
        visible = lines.some((line) => isSelectionRectVisible(line, clips));
      }
      if (!visible) {
        clear();
        return;
      }
      const existingHighlightId =
        readThreadHighlights(threadRef).find((highlight) => {
          if (highlight.messageId !== messageId) return false;
          const highlightRange = resolveAssistantCitationRange(captured.source, highlight.selector);
          return highlightRange !== null && rangesEqual(highlightRange, captured.range);
        })?.id ?? null;
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
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...captured.selector,
        },
        existingHighlightId,
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
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
    // Tab belongs to the foreground chat; a background timeline only follows its selection.
    if (!backgroundThread) document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [backgroundThread, threadRef, viewport]);

  if (!selection) return null;
  const citeTooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const highlightTooLong = selection.citation.text.length > MAX_HIGHLIGHT_TEXT_LENGTH;
  const hasExistingHighlight = selection.existingHighlightId !== null;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    dismiss();
  };
  const cite = () => {
    if (citeTooLong || !onCite(selection.citation, selection.sourceAnchor)) return false;
    clearSelection();
    return true;
  };
  const toggleHighlight = () => {
    if (highlightTooLong) return;
    if (selection.existingHighlightId) {
      useHighlightStore.getState().removeHighlights(threadRef, [selection.existingHighlightId]);
      clearSelection();
      return;
    }
    const result = useHighlightStore.getState().addHighlight(threadRef, {
      messageId: selection.citation.messageId,
      selector: {
        text: selection.citation.text,
        start: selection.citation.start,
        end: selection.citation.end,
        prefix: selection.citation.prefix,
        suffix: selection.citation.suffix,
      },
    });
    if (!result.ok) {
      toastManager.add({
        type: "warning",
        title:
          result.reason === "too_long"
            ? "Selection is too long to highlight"
            : result.reason === "limit"
              ? "This thread has reached its highlight limit"
              : "This text is already highlighted",
      });
      return;
    }
    clearSelection();
  };
  return createPortal(
    <div
      ref={toolbarRef}
      role="toolbar"
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
        disabled={citeTooLong}
        aria-label={citeTooLong ? "Selection is too long to cite" : "Cite selection in composer"}
        onClick={cite}
      >
        <QuoteIcon aria-hidden="true" className="size-3.5" />
        {citeTooLong ? "Shorten selection" : "Cite"}
      </Button>
      <Button
        type="button"
        size="xs"
        variant="glass"
        disabled={highlightTooLong}
        aria-label={
          highlightTooLong
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
        {hasExistingHighlight ? "Remove highlight" : "Highlight"}
      </Button>
    </div>,
    document.body,
  );
}
