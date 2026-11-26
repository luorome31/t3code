import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import type { HighlightNote, ThreadHighlight } from "~/highlightStore";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle } from "../ui/popover";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { toastManager } from "../ui/toast";
import { HighlightNotes } from "./HighlightNotes";

export interface HighlightNoteTarget {
  id: string;
  trigger: HTMLElement;
  rect: DOMRect;
}

export function highlightNoteTarget(id: string, trigger: HTMLElement): HighlightNoteTarget {
  return { id, trigger, rect: trigger.getBoundingClientRect() };
}

export function useHighlightNoteGuard() {
  const gt = useGT();
  const [dirty, setDirty] = useState(false);
  const canLeave = () => {
    if (!dirty) return true;
    toastManager.add({ type: "warning", title: gt("Save or cancel your note first") });
    return false;
  };
  return { dirty, setDirty, canLeave };
}

export function HighlightNoteSurface({
  threadRef,
  highlight,
  target,
  onInsert,
  onClose,
  noteGuard,
}: {
  threadRef: ScopedThreadRef;
  highlight: ThreadHighlight;
  target: HighlightNoteTarget;
  onInsert?: ((highlight: ThreadHighlight, note: HighlightNote) => boolean) | undefined;
  onClose: () => void;
  noteGuard: ReturnType<typeof useHighlightNoteGuard>;
}) {
  const gt = useGT();
  const narrow = useMediaQuery("max-sm");
  const { dirty, setDirty, canLeave } = noteGuard;
  const requestClose = () => {
    if (canLeave()) onClose();
  };
  const popupRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const [anchor] = useState(() => ({
    getBoundingClientRect: () =>
      target.trigger.isConnected ? target.trigger.getBoundingClientRect() : target.rect,
  }));
  const initialFocus = () => popupRef.current?.querySelector("textarea") ?? popupRef.current;
  const finalFocus = () =>
    restoreFocus.current && target.trigger.isConnected ? target.trigger : false;
  const title = gt("Highlight notes");
  const content = (
    <>
      <blockquote className="mb-3 line-clamp-2 border-s-2 border-border ps-2.5 text-sm text-muted-foreground wrap-anywhere">
        {highlight.selector.text}
      </blockquote>
      <HighlightNotes
        threadRef={threadRef}
        highlight={highlight}
        onDirtyChange={setDirty}
        onInsert={
          onInsert
            ? (note) => {
                if (onInsert(highlight, note)) {
                  restoreFocus.current = false;
                  onClose();
                }
              }
            : undefined
        }
      />
    </>
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores the source trigger when this controlled surface unmounts
  useLayoutEffect(
    () => () => {
      if (
        restoreFocus.current &&
        target.trigger.isConnected &&
        popupRef.current?.contains(document.activeElement)
      ) {
        target.trigger.focus({ preventScroll: true });
      }
    },
    [target],
  );

  if (narrow) {
    return (
      <Sheet
        open
        onOpenChange={(open, event) => {
          if (open) return;
          if (dirty) event.cancel();
          else onClose();
        }}
      >
        <SheetPopup
          ref={popupRef}
          side="bottom"
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          showCloseButton={false}
        >
          <SheetHeader>
            <div className="flex items-center justify-between gap-2">
              <SheetTitle>{title}</SheetTitle>
              <Button
                variant="ghost"
                size="icon"
                aria-label={gt("Close notes")}
                onClick={requestClose}
              >
                <XIcon aria-hidden />
              </Button>
            </div>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto px-6 pb-6">{content}</div>
          <div aria-hidden className="shrink-0" style={{ height: "env(safe-area-inset-bottom)" }} />
        </SheetPopup>
      </Sheet>
    );
  }
  return (
    <Popover
      open
      onOpenChange={(open, event) => {
        if (open) return;
        if (dirty) event.cancel();
        else onClose();
      }}
    >
      <PopoverPopup
        ref={popupRef}
        anchor={anchor}
        align="start"
        width="md"
        padding="compact"
        sideOffset={6}
        initialFocus={initialFocus}
        finalFocus={finalFocus}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <PopoverTitle>{title}</PopoverTitle>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={gt("Close notes")}
            onClick={requestClose}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
        {content}
      </PopoverPopup>
    </Popover>
  );
}
