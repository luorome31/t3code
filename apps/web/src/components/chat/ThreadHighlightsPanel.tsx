import { useBlocker, useNavigate } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ArrowUpRightIcon, HighlighterIcon } from "lucide-react";
import { useLayoutEffect, useState } from "react";

import { guardHighlightsPanelExit } from "~/rightPanelStore";
import { useThreadHighlights } from "~/highlightStore";
import type { HighlightDraftContent } from "~/lib/highlightDraftInsert";
import { HighlightsFilterControls } from "../highlights/HighlightsFilterControls";
import { HighlightsWorkbench, useHighlightsWorkbench } from "../highlights/HighlightsWorkbench";
import { useHighlightNoteGuard } from "../highlights/HighlightNoteSurface";
import {
  threadWorkbenchHighlights,
  type HighlightsSearch,
} from "../highlights/highlightsWorkbench.logic";
import { Button } from "../ui/button";

export function ThreadHighlightsPanel({
  threadRef,
  onInsert,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onInsert: (content: HighlightDraftContent) => boolean;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const highlights = useThreadHighlights(threadRef);
  const items = threadWorkbenchHighlights(threadRef, highlights);
  const [filters, setFilters] = useState<HighlightsSearch>({});
  const guard = useHighlightNoteGuard();
  const { dirty, canLeave } = guard;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the note guard with the external panel store
  useLayoutEffect(() => guardHighlightsPanelExit(threadRef, canLeave), [threadRef, canLeave]);
  useBlocker({
    shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname && !canLeave(),
    enableBeforeUnload: dirty,
  });
  const workbench = useHighlightsWorkbench({ items, filters, onFiltersChange: setFilters, guard });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <HighlighterIcon aria-hidden className="size-4" />
            {gt("Highlights")}
          </h2>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (guard.canLeave())
                void navigate({ to: "/highlights", search: { ...filters, scope: "thread" } });
            }}
          >
            {gt("Open overview")}
            <ArrowUpRightIcon />
          </Button>
        </div>
        <HighlightsFilterControls
          mode="compact"
          items={items}
          filters={filters}
          change={workbench.change}
        />
      </div>
      <HighlightsWorkbench
        state={workbench}
        items={items}
        filters={filters}
        guard={guard}
        compact
        showThread={false}
        returnThreadKey={null}
        canJump={() => true}
        onInsert={onInsert}
      />
    </div>
  );
}
