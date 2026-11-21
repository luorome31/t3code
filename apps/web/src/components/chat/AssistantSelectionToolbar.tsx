import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useGT } from "gt-react";
import { MessageCircleMoreIcon, QuoteIcon } from "lucide-react";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HighlightColor, ThreadHighlight } from "~/highlightStore";
import {
  MAX_HIGHLIGHTS_PER_THREAD,
  MAX_HIGHLIGHT_TEXT_LENGTH,
  readThreadHighlights,
  sameHighlightSelector,
  useHighlightStore,
} from "~/highlightStore";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import { topmostHighlightHitAt } from "~/lib/highlightHitTargets";
import { observeResize } from "~/lib/observeResize";
import {
  isSelectionRangeVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { selectedSmalltalkAtom, smalltalkEnvironment } from "../../state/smalltalk";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRightPanelStore } from "../../rightPanelStore";
import { HighlightToolbarActions } from "../highlights/HighlightToolbarActions";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BackgroundThreadContext } from "./backgroundThread";

interface ClickedHighlight {
  readonly highlight: ThreadHighlight;
  readonly range: Range;
  readonly position: SelectionActionPoint;
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
  const [clickedHighlight, setClickedHighlight] = useState<ClickedHighlight | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const backgroundThread = use(BackgroundThreadContext);
  const gt = useGT();
  const { environmentId, threadId } = threadRef;
  const threadKey = scopedThreadKey(threadRef);
  const position = selection?.position ?? clickedHighlight?.position ?? null;
  const smalltalkConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const smalltalkAllowed = useAtomValue(smalltalkEnvironment.mutate.permissionAtom(environmentId));
  const smalltalkMutate = useAtomCommand(smalltalkEnvironment.mutate);
  const selectSmalltalk = useAtomSet(selectedSmalltalkAtom(threadKey));
  const [smalltalkBusy, setSmalltalkBusy] = useState(false);
  const smalltalkSupported =
    smalltalkConfig?.environment.capabilities.smalltalk === true &&
    smalltalkConfig.environment.capabilities.smalltalkExcerptSource === true &&
    smalltalkAllowed;

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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selectionchange and keydown to track text selections in the viewport
  useEffect(() => {
    if (!viewport) return;
    const clear = () => {
      setSelection(null);
      setClickedHighlight(null);
    };
    // A plain click has no selection of its own, so it acts on the painted highlight under it.
    const clickHighlight = (
      pointer: SelectionActionPoint,
    ): { highlight: ThreadHighlight; range: Range } | null => {
      const hit = topmostHighlightHitAt(viewport, pointer.x, pointer.y);
      if (hit === null) return null;
      const highlight = readThreadHighlights({ environmentId, threadId }).find(
        (candidate) => candidate.id === hit.id && candidate.source.kind === "assistant-message",
      );
      return highlight === undefined ? null : { highlight, range: hit.range };
    };
    const update = (
      pointer: SelectionActionPoint | null,
      clicked: ReturnType<typeof clickHighlight>,
    ) => {
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        if (
          pointer !== null &&
          clicked !== null &&
          (nativeSelection === null || nativeSelection.isCollapsed)
        ) {
          setSelection(null);
          setClickedHighlight({
            highlight: clicked.highlight,
            range: clicked.range,
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
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (!isSelectionRangeVisible(captured.range, viewport)) {
        clear();
        return;
      }
      const existingHighlightId =
        readThreadHighlights({ environmentId, threadId }).find(
          (highlight) =>
            highlight.source.kind === "assistant-message" &&
            highlight.source.messageId === messageId &&
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
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 1,
          environmentId,
          threadId,
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
    // Tab belongs to the foreground chat; a background timeline only follows its selection.
    if (!backgroundThread) document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [backgroundThread, environmentId, threadId, viewport]);

  if (!selection && !clickedHighlight) return null;
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
    const citeTooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
    const highlightTooLong = selection.citation.text.length > MAX_HIGHLIGHT_TEXT_LENGTH;
    const cite = () => {
      if (citeTooLong || !onCite(selection.citation, selection.sourceAnchor)) return false;
      clearSelection();
      return true;
    };
    const removeHighlight = () => {
      if (!selection.existingHighlightId) return;
      const selectionThreadRef: ScopedThreadRef = {
        environmentId: selection.citation.environmentId,
        threadId: selection.citation.threadId,
      };
      useHighlightStore
        .getState()
        .removeHighlights(selectionThreadRef, [selection.existingHighlightId]);
      clearSelection();
    };
    const addHighlight = (color: HighlightColor) => {
      if (highlightTooLong) return;
      const selectionThreadRef: ScopedThreadRef = {
        environmentId: selection.citation.environmentId,
        threadId: selection.citation.threadId,
      };
      if (scopedThreadKey(selectionThreadRef) !== threadKey) return;
      const result = useHighlightStore.getState().addHighlight(selectionThreadRef, {
        source: { kind: "assistant-message", messageId: selection.citation.messageId },
        selector: {
          text: selection.citation.text,
          start: selection.citation.start,
          end: selection.citation.end,
          prefix: selection.citation.prefix,
          suffix: selection.citation.suffix,
        },
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
                : gt("This text is already highlighted"),
        });
        return;
      }
      clearSelection();
    };
    const explainTooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
    const explainLabel = explainTooLong
      ? gt("Selection is too long to explain")
      : gt("Explain selection in plain language");
    const explainSelection = () => {
      if (explainTooLong || !smalltalkSupported) return;
      setSmalltalkBusy(true);
      void smalltalkMutate({
        environmentId,
        input: {
          action: "create",
          threadId,
          source: {
            kind: "excerpt",
            messageId: selection.citation.messageId,
            text: selection.citation.text,
            start: selection.citation.start,
            end: selection.citation.end,
            prefix: selection.citation.prefix,
            suffix: selection.citation.suffix,
          },
        },
      })
        .then((result) => {
          if (result._tag === "Success" && result.value) {
            selectSmalltalk(result.value.id);
            useRightPanelStore.getState().open(threadRef, "smalltalk");
            clearSelection();
          }
        })
        .finally(() => setSmalltalkBusy(false));
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
        <Button
          type="button"
          size="xs"
          variant="glass"
          disabled={citeTooLong}
          aria-label={
            citeTooLong ? gt("Selection is too long to cite") : gt("Cite selection in composer")
          }
          onClick={cite}
        >
          <QuoteIcon aria-hidden="true" className="size-3.5" />
          {citeTooLong
            ? gt("Shorten selection")
            : gt("Cite", { $context: "verb, button that quotes the selected text" })}
        </Button>
        <HighlightToolbarActions
          threadRef={threadRef}
          supported={highlightSupported}
          tooLong={highlightTooLong}
          hasExistingHighlight={selection.existingHighlightId !== null}
          onAdd={addHighlight}
          onRemove={removeHighlight}
        />
        {smalltalkSupported ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="xs"
                  variant="glass"
                  aria-label={explainLabel}
                  disabled={explainTooLong || smalltalkBusy}
                  onClick={explainSelection}
                />
              }
            >
              <MessageCircleMoreIcon aria-hidden="true" className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>{explainLabel}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>,
      document.body,
    );
  }
  const clicked = clickedHighlight!;
  const citeClickedHighlight = () => {
    if (viewport === null) return false;
    const highlight = clicked.highlight;
    if (highlight.source.kind !== "assistant-message") return false;
    const citation: AssistantCitation = {
      version: 1,
      environmentId,
      threadId,
      messageId: highlight.source.messageId,
      ...highlight.selector,
      ...(highlight.note !== undefined ? { comment: highlight.note } : {}),
    };
    if (citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) return false;
    const start = clicked.range.startContainer;
    const source = (
      start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement
    )?.closest<HTMLElement>("[data-assistant-citation-source]");
    if (!source || !onCite(citation, { source, range: clicked.range, viewport })) return false;
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
      aria-label={gt("Highlight actions")}
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
      <Button
        type="button"
        size="xs"
        variant="glass"
        aria-label={gt("Cite highlight in composer")}
        onClick={citeClickedHighlight}
      >
        <QuoteIcon aria-hidden="true" className="size-3.5" />
        {gt("Cite", { $context: "verb, button that quotes the selected text" })}
      </Button>
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
