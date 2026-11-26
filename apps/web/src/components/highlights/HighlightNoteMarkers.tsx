import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { StickyNoteIcon } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useThreadHighlights } from "~/highlightStore";
import { readHighlightHitTargets, subscribeToHighlightHitTargets } from "~/lib/highlightHitTargets";
import { observeResize } from "~/lib/observeResize";
import { Button } from "../ui/button";

interface Marker {
  id: string;
  x: number;
  y: number;
}

export function HighlightNoteMarkers({
  container,
  viewport,
  threadRef,
  onOpen,
}: {
  container: HTMLElement | null;
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onOpen: (id: string, anchor: HTMLElement) => void;
}) {
  const gt = useGT();
  const highlights = useThreadHighlights(threadRef);
  const noted = new Map(
    highlights.flatMap((highlight) =>
      highlight.notes?.length ? [[highlight.id, highlight.notes.length] as const] : [],
    ),
  );
  const sheet = container?.closest<HTMLElement>('[data-slot="sheet-popup"]') ?? null;
  const [markers, setMarkers] = useState<Marker[]>([]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- positions markers against the painted DOM ranges without changing selectable text or message layout
  useLayoutEffect(() => {
    if (!container || !viewport || !highlights.some((highlight) => highlight.notes?.length)) return;
    const ids = new Set(
      highlights.filter((highlight) => highlight.notes?.length).map(({ id }) => id),
    );
    const view = viewport.ownerDocument.defaultView!;
    let frame = 0;
    const place = () => {
      frame = 0;
      const bounds = viewport.getBoundingClientRect();
      const sheetBounds = sheet?.getBoundingClientRect();
      const left = Math.max(bounds.left, sheetBounds?.left ?? 0, 0);
      const right = Math.min(bounds.right, sheetBounds?.right ?? view.innerWidth, view.innerWidth);
      const top = Math.max(bounds.top, sheetBounds?.top ?? 0, 0);
      const bottom = Math.min(
        bounds.bottom,
        sheetBounds?.bottom ?? view.innerHeight,
        view.innerHeight,
      );
      const offsetX = sheet && sheetBounds ? sheetBounds.left + sheet.clientLeft : 0;
      const offsetY = sheet && sheetBounds ? sheetBounds.top + sheet.clientTop : 0;
      const next: Marker[] = [];
      for (const { id, range } of readHighlightHitTargets(container)) {
        if (!ids.has(id)) continue;
        const end = range.cloneRange();
        end.collapse(false);
        const rect = end.getClientRects().item(0) ?? Array.from(range.getClientRects()).at(-1);
        if (
          !rect ||
          rect.bottom <= top ||
          rect.top >= bottom ||
          rect.right <= left ||
          rect.right > right
        )
          continue;
        next.push({
          id,
          x: Math.round(Math.max(left, Math.min(rect.right + 2, right - 42)) - offsetX),
          y: Math.round(Math.max(top, rect.top - 15) - offsetY),
        });
      }
      setMarkers((previous) =>
        previous.length === next.length &&
        previous.every((item, index) => {
          const marker = next[index];
          return marker?.id === item.id && marker.x === item.x && marker.y === item.y;
        })
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = view.requestAnimationFrame(place);
    };
    schedule();
    const unsubscribe = subscribeToHighlightHitTargets(schedule);
    const stopResize = observeResize(
      container === viewport ? container : [container, viewport],
      schedule,
    );
    view.addEventListener("scroll", schedule, { capture: true, passive: true });
    view.addEventListener("resize", schedule);
    return () => {
      view.cancelAnimationFrame(frame);
      view.removeEventListener("scroll", schedule, true);
      view.removeEventListener("resize", schedule);
      unsubscribe();
      stopResize();
    };
  }, [container, highlights, sheet, viewport]);

  if (!container || !viewport || !noted.size) return null;
  return createPortal(
    markers.map(({ id, x, y }) => {
      const count = noted.get(id);
      if (!count) return null;
      return (
        <div
          key={id}
          className={`${sheet ? "absolute" : "fixed"} z-20 select-none [-webkit-app-region:no-drag]`}
          style={{ left: x, top: y }}
        >
          <Button
            size="micro"
            variant="glass"
            aria-haspopup="dialog"
            aria-label={gt("Open highlight notes ({count, number})", { count })}
            onClick={(event) => onOpen(id, event.currentTarget)}
          >
            <StickyNoteIcon aria-hidden />
            {count}
          </Button>
        </div>
      );
    }),
    sheet ?? container.ownerDocument.body,
  );
}
