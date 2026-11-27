import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { CircleHelpIcon, HighlighterIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { useHighlightStore } from "~/highlightStore";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { appendHighlightsToThreadDraft } from "~/lib/highlightDraftInsert";
import { requestWorkspaceFocus, workspaceAreaProps } from "~/lib/workspaceFocus";
import { useQuietThreadShells } from "~/state/entities";
import { liveShellEnvironmentIdsAtom } from "~/state/shell";
import { buildThreadRouteParams } from "~/threadRoutes";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { getAppModalReturnThreadTarget, useCloseAppModal } from "../sidebar/mainAppLocation";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { useHighlightNoteGuard } from "./HighlightNoteSurface";
import { HighlightsFilterControls } from "./HighlightsFilterControls";
import {
  HighlightsWorkbench,
  useHighlightsWorkbench,
  type WorkbenchInsert,
} from "./HighlightsWorkbench";
import {
  collectWorkbenchHighlights,
  scopeWorkbenchHighlights,
  type HighlightsSearch,
} from "./highlightsWorkbench.logic";

export function HighlightsModalPage({
  initialSearch,
  onSearchChange,
}: {
  initialSearch: HighlightsSearch;
  onSearchChange: (search: HighlightsSearch) => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const closeAppModal = useCloseAppModal();
  const returnTarget = getAppModalReturnThreadTarget();
  const returnRef = returnTarget?.kind === "server" ? returnTarget.threadRef : null;
  const returnKey = returnRef ? scopedThreadKey(returnRef) : null;
  const wide = useMediaQuery("(min-width: 860px)");
  const [helpOpen, setHelpOpen] = useState(false);
  const [search, setSearch] = useState(initialSearch);
  const [pinnedTarget, setPinnedTarget] = useState<ScopedThreadRef | null>(null);
  const [lastInsert, setLastInsert] = useState<{ ref: ScopedThreadRef; count: number } | null>(
    null,
  );
  const threads = useQuietThreadShells();
  const live = useAtomValue(liveShellEnvironmentIdsAtom);
  const byThreadKey = useHighlightStore((state) => state.byThreadKey);
  const threadByKey = new Map(
    threads.map((thread) => [
      scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      thread,
    ]),
  );
  const returnThread = returnKey ? threadByKey.get(returnKey) : undefined;
  const scope =
    search.scope === "thread" && returnRef
      ? "thread"
      : search.scope === "all"
        ? "all"
        : returnThread
          ? "project"
          : "all";
  const filters: HighlightsSearch = { ...search, scope };
  const allItems = collectWorkbenchHighlights(byThreadKey, threadByKey);
  const items = scopeWorkbenchHighlights(allItems, scope, returnKey, returnThread);
  const guard = useHighlightNoteGuard();
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname === "/highlights" && next.pathname !== current.pathname && !guard.canLeave(),
    enableBeforeUnload: guard.dirty,
  });
  const workbench = useHighlightsWorkbench({
    items,
    filters,
    guard,
    onFiltersChange: (next) => {
      setSearch(next);
      onSearchChange(next);
    },
  });
  const activeTarget = workbench.active?.threadRef ?? null;
  const target = returnRef ?? pinnedTarget ?? activeTarget;
  const targetKey = target ? scopedThreadKey(target) : null;
  const titleFor = (ref: ScopedThreadRef) =>
    threadByKey.get(scopedThreadKey(ref))?.title ?? gt("Archived or offline thread");
  const canOpen = (ref: ScopedThreadRef) =>
    live.has(ref.environmentId) && threadByKey.get(scopedThreadKey(ref))?.archivedAt === null;
  const insert: WorkbenchInsert = (content, entries) => {
    const target = returnRef ?? pinnedTarget ?? entries[0]?.threadRef;
    if (!target || !appendHighlightsToThreadDraft(target, content)) return false;
    if (!returnRef) setPinnedTarget(target);
    const count = content.citations.length + content.excerpts.length;
    const key = scopedThreadKey(target);
    setLastInsert((previous) => ({
      ref: target,
      count: count + (previous && scopedThreadKey(previous.ref) === key ? previous.count : 0),
    }));
    toastManager.add({
      type: "success",
      title: gt("Added to chat draft"),
      description: threadByKey.get(key)?.hasPendingUserInput
        ? gt("Your answer is unchanged.")
        : gt("Target thread: {title}", { title: titleFor(target) }),
    });
    return true;
  };
  const close = async () => {
    const inserted = lastInsert?.ref;
    if (inserted && !returnRef && canOpen(inserted)) {
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(inserted),
        replace: true,
      });
    } else {
      await closeAppModal();
    }
    if (
      inserted &&
      (returnRef || canOpen(inserted)) &&
      !threadByKey.get(scopedThreadKey(inserted))?.hasPendingUserInput
    ) {
      requestWorkspaceFocus({ area: "composer", selector: '[contenteditable="true"]' });
    }
  };
  const shortcuts = [
    { keys: "J / K", label: gt("Move between highlights") },
    { keys: "N", label: gt("Add note") },
    { keys: "C", label: gt("Toggle context") },
    { keys: "X", label: gt("Toggle selection") },
    { keys: "/", label: gt("Search highlights and notes") },
    { keys: "Enter ×2", label: gt("Save note, then add to chat draft") },
  ];
  const title = gt("Highlights and notes");
  const selectedFromOneThread = workbench.selected.every(
    (item) => item.threadKey === workbench.selected[0]?.threadKey,
  );
  const canInsertBatch = Boolean(returnRef || pinnedTarget || selectedFromOneThread);
  return (
    <AppRouteModal
      label={title}
      canClose={guard.canLeave}
      onClose={close}
      onKeyDown={(event) =>
        workbench.onShortcut(event, event.currentTarget, () => setHelpOpen(!helpOpen))
      }
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <HighlighterIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <h1 className="text-base font-semibold tracking-tight sm:text-xl">{title}</h1>
        </div>
        <div className="flex items-center gap-1">
          <Popover open={helpOpen} onOpenChange={setHelpOpen}>
            <PopoverTrigger
              render={
                <Button size="icon-sm" variant="ghost" aria-label={gt("Keyboard shortcuts")} />
              }
            >
              <CircleHelpIcon />
            </PopoverTrigger>
            <PopoverPopup align="end" width="sm" aria-label={gt("Keyboard shortcuts")}>
              <dl className="flex flex-col gap-2">
                {shortcuts.map(({ keys, label }) => (
                  <div key={keys} className="flex items-center justify-between gap-3 text-xs">
                    <dt>{label}</dt>
                    <dd>
                      <kbd className="whitespace-nowrap rounded border bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </PopoverPopup>
          </Popover>
          <AppRouteModalClose />
        </div>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-[72rem] flex-1 flex-col min-[860px]:flex-row min-[860px]:gap-4 min-[860px]:px-4">
        <div
          {...workspaceAreaProps("highlights-filters", 0, gt("Filter highlights"))}
          className="shrink-0 border-b px-3 py-2 min-[860px]:w-54 min-[860px]:overflow-y-auto min-[860px]:border-0 min-[860px]:px-0 min-[860px]:py-3"
        >
          <HighlightsFilterControls
            mode={wide ? "rail" : "compact"}
            items={items}
            filters={filters}
            change={workbench.change}
            scopeOptions={{ thread: Boolean(returnRef), project: Boolean(returnThread) }}
          />
        </div>
        <div
          {...workspaceAreaProps("highlights-stream", 1, title)}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <HighlightsWorkbench
            state={workbench}
            items={items}
            filters={filters}
            guard={guard}
            compact={false}
            showThread={scope !== "thread"}
            returnThreadKey={returnKey}
            canJump={(item) => canOpen(item.threadRef)}
            onInsert={insert}
            canInsertBatch={canInsertBatch}
            footer={
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-background px-3 py-2.5">
                <div
                  role="status"
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                >
                  <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
                  {target ? (
                    <span className="wrap-anywhere font-medium text-foreground">
                      {gt("Target thread: {title}", { title: titleFor(target) })}
                    </span>
                  ) : (
                    gt("Choose a highlight to start a draft")
                  )}
                  {lastInsert && targetKey === scopedThreadKey(lastInsert.ref) && (
                    <span>
                      {gt(
                        "{count, plural, one {# item added to draft} other {# items added to draft}}",
                        { count: lastInsert.count },
                      )}
                    </span>
                  )}
                  {!canInsertBatch && (
                    <span>
                      {gt("Choose a target thread to merge highlights from different threads.")}
                    </span>
                  )}
                </div>
                {!returnRef &&
                  activeTarget &&
                  (pinnedTarget ? (
                    <Button size="xs" variant="ghost" onClick={() => setPinnedTarget(null)}>
                      {gt("Use source thread")}
                    </Button>
                  ) : (
                    <Button size="xs" variant="ghost" onClick={() => setPinnedTarget(activeTarget)}>
                      {gt("Set as draft target")}
                    </Button>
                  ))}
                <DialogPrimitive.Close render={<Button size="xs" variant="outline" />}>
                  {lastInsert && (returnRef || canOpen(lastInsert.ref))
                    ? gt("Return to draft (Esc)")
                    : gt("Close (Esc)")}
                </DialogPrimitive.Close>
              </footer>
            }
          />
        </div>
      </div>
    </AppRouteModal>
  );
}
