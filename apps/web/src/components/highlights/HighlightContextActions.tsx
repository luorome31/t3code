import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { ChevronDownIcon, EllipsisIcon, QuoteIcon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useHighlightStore, type ThreadHighlight } from "~/highlightStore";
import { highlightColorDefinition } from "~/lib/highlightColors";
import { observeResize } from "~/lib/observeResize";
import type { SelectionActionPoint } from "~/lib/selectionActions";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { HighlightColorPicker } from "./HighlightColorPicker";

export function HighlightContextActions({
  highlight,
  threadRef,
  position,
  viewport,
  toolbarRef,
  onCite,
  onNotes,
  onRemove,
  onDismiss,
}: {
  highlight: ThreadHighlight;
  threadRef: ScopedThreadRef;
  position: SelectionActionPoint;
  viewport: HTMLElement;
  toolbarRef: RefObject<HTMLDivElement | null>;
  onCite?: (() => boolean) | undefined;
  onNotes: (trigger: HTMLElement) => void;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState(
    () => useHighlightStore.getState().existingPaletteExpanded,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const paletteId = useId();
  const color = highlightColorDefinition(highlight.color);
  const sheet = viewport.closest<HTMLElement>('[data-slot="sheet-popup"]');
  const closePalette = () => {
    triggerRef.current?.focus({ preventScroll: true });
    setExpanded(false);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures and positions both surfaces before paint without including the palette in the toolbar's width
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const trigger = triggerRef.current;
    if (!toolbar || !trigger) return;
    const palette = expanded ? paletteRef.current : null;
    const place = () => {
      const bounds = viewport.getBoundingClientRect();
      const sheetBounds = sheet?.getBoundingClientRect();
      const left = Math.max(8, bounds.left + 8);
      const right = Math.min(window.innerWidth, bounds.right) - 8;
      const top = Math.max(0, sheetBounds?.top ?? 0) + 8;
      const bottom = Math.min(window.innerHeight, sheetBounds?.bottom ?? window.innerHeight) - 8;
      const offsetX = sheet && sheetBounds ? sheetBounds.left + sheet.clientLeft : 0;
      const offsetY = sheet && sheetBounds ? sheetBounds.top + sheet.clientTop : 0;
      const maxWidth = `${Math.max(0, right - left)}px`;
      toolbar.style.maxWidth = maxWidth;
      const { width, height } = toolbar.getBoundingClientRect();
      const x = Math.max(left, Math.min(position.x, right - width));
      let y = Math.max(top, Math.min(position.y, bottom - height));
      toolbar.style.left = `${x - offsetX}px`;
      toolbar.style.top = `${y - offsetY}px`;
      if (!palette) return;

      const gap = 6;
      palette.style.maxWidth = maxWidth;
      const paletteRect = palette.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const sideY = triggerRect.top + (triggerRect.height - paletteRect.height) / 2;
      if (x + width + gap + paletteRect.width <= right) {
        palette.style.left = `${width + gap}px`;
        palette.style.top = `${Math.max(top, Math.min(sideY, bottom - paletteRect.height)) - y}px`;
        return;
      }
      const above =
        y + height + gap + paletteRect.height > bottom && y - gap - paletteRect.height >= top;
      if (!above) {
        y = Math.max(top, Math.min(y, bottom - height - gap - paletteRect.height));
        toolbar.style.top = `${y - offsetY}px`;
      }
      palette.style.left = `${Math.max(left, Math.min(triggerRect.left, right - paletteRect.width)) - x}px`;
      palette.style.top = `${above ? -gap - paletteRect.height : height + gap}px`;
    };
    place();
    return observeResize([viewport, toolbar], place);
  }, [expanded, position, sheet, toolbarRef, viewport]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Escape closes the palette before the selection observer or an enclosing sheet can dismiss, including before focus enters the toolbar
  useLayoutEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closePalette();
    };
    const document = viewport.ownerDocument;
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [closePalette, expanded, viewport]);

  return createPortal(
    <div
      ref={toolbarRef}
      role="group"
      aria-label={gt("Highlight actions")}
      className={`${sheet ? "absolute" : "fixed"} z-50 flex w-max flex-wrap items-center gap-1 [-webkit-app-region:no-drag]`}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      {onCite ? (
        <Button
          size="xs"
          variant="glass"
          aria-label={gt("Cite highlight in composer")}
          onClick={onCite}
        >
          <QuoteIcon aria-hidden />
          {gt("Cite", { $context: "verb, button that quotes the selected text" })}
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="glass"
        aria-haspopup="dialog"
        onClick={(event) => onNotes(event.currentTarget)}
      >
        <StickyNoteIcon aria-hidden />
        {highlight.notes?.length
          ? gt("Notes ({count, number})", { count: highlight.notes.length })
          : gt("Add note")}
      </Button>
      <Button
        ref={triggerRef}
        size="xs"
        variant="glass"
        aria-label={gt("Change highlight color: {color}", { color: m(color.label) })}
        aria-expanded={expanded}
        aria-controls={expanded ? paletteId : undefined}
        onClick={() => setExpanded(!expanded)}
      >
        <span
          aria-hidden
          className="size-3.5 rounded-full border border-border"
          style={{ backgroundColor: `var(${color.cssVariable})` }}
        />
        <ChevronDownIcon aria-hidden className="size-3" />
      </Button>
      {expanded ? (
        <div
          ref={paletteRef}
          id={paletteId}
          className="dropdown-glass absolute w-max rounded-lg p-1.5 text-popover-foreground shadow-md"
        >
          <HighlightColorPicker
            value={highlight.color}
            wrap
            onChange={(next) => {
              if (
                next !== highlight.color &&
                !useHighlightStore.getState().recolorHighlight(threadRef, highlight.id, next)
              ) {
                toastManager.add({ type: "warning", title: gt("Could not save this highlight") });
                return;
              }
              closePalette();
            }}
          />
        </div>
      ) : null}
      <Button
        size="xs"
        variant="glass"
        aria-label={gt("More highlight actions")}
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        <EllipsisIcon aria-hidden />
      </Button>
      {more ? (
        <Button size="xs" variant="glass" onClick={onRemove}>
          <Trash2Icon aria-hidden />
          {gt("Remove highlight")}
        </Button>
      ) : null}
    </div>,
    sheet ?? viewport.ownerDocument.body,
  );
}
