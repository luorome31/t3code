import { useNavigate } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { FileTextIcon, HighlighterIcon, MessageSquareIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { requestFileHighlightReveal } from "~/fileHighlightRevealStore";
import {
  readThreadHighlights,
  useHighlightStore,
  type HighlightNote,
  type RemovedHighlight,
} from "~/highlightStore";
import { assistantCitationNavigation } from "~/lib/assistantCitationNavigation";
import { messageHighlightCitation } from "~/lib/highlightCitation";
import { highlightColorDefinition, type HighlightColor } from "~/lib/highlightColors";
import type { HighlightDraftContent } from "~/lib/highlightDraftInsert";
import { useRightPanelStore } from "~/rightPanelStore";
import { buildThreadRouteParams } from "~/threadRoutes";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { toastManager } from "../ui/toast";
import { HighlightCard, HighlightSearchText } from "./HighlightCard";
import { HighlightColorPicker } from "./HighlightColorPicker";
import type { useHighlightNoteGuard } from "./HighlightNoteSurface";
import { HighlightSwatch } from "./HighlightsFilterControls";
import {
  filterWorkbenchHighlights,
  groupWorkbenchHighlights,
  workbenchDraftContent,
  type HighlightsSearch,
  type WorkbenchHighlight,
} from "./highlightsWorkbench.logic";

function itemsByThread(items: readonly WorkbenchHighlight[]) {
  const groups = new Map<string, WorkbenchHighlight[]>();
  for (const item of items) {
    const group = groups.get(item.threadKey);
    if (group) group.push(item);
    else groups.set(item.threadKey, [item]);
  }
  return groups.values();
}

export type WorkbenchInsert = (
  content: HighlightDraftContent,
  items: readonly WorkbenchHighlight[],
) => boolean;

export function useHighlightsWorkbench({
  items,
  filters,
  onFiltersChange,
  guard,
}: {
  items: readonly WorkbenchHighlight[];
  filters: HighlightsSearch;
  onFiltersChange: (filters: HighlightsSearch) => void;
  guard: ReturnType<typeof useHighlightNoteGuard>;
}) {
  const gt = useGT();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const streamRef = useRef<HTMLDivElement>(null);
  const assistant = gt("Assistant message");
  const missingThread = gt("Archived or offline thread");
  const visible = filterWorkbenchHighlights(items, filters, { assistant, missingThread });
  // Saving can change note status or search membership before focus reaches the insert button.
  const saved =
    savedKey && !visible.some((item) => item.key === savedKey)
      ? items.find((item) => item.key === savedKey)
      : undefined;
  const groups = groupWorkbenchHighlights(saved ? [...visible, saved] : visible, filters.group);
  const ordered = groups.flatMap((group) => group.items);
  const selected = ordered.filter((item) => selectedKeys.has(item.key));
  const active = ordered.find((item) => item.key === activeKey) ?? ordered[0];
  const toggleSelection = (key: string) =>
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const card = (key: string) =>
    streamRef.current?.querySelector<HTMLElement>(`[data-highlight-key="${CSS.escape(key)}"]`);
  return {
    groups,
    ordered,
    selected,
    active,
    editingKey,
    streamRef,
    clearSelection: () => setSelectedKeys(new Set()),
    selectAll: (checked: boolean) =>
      setSelectedKeys(new Set(checked ? ordered.map((item) => item.key) : [])),
    toggleSelection,
    activate: setActiveKey,
    startNote: (item: WorkbenchHighlight) => {
      if (editingKey === item.key) return true;
      if (!guard.canLeave()) return false;
      setEditingKey(item.key);
      setActiveKey(item.key);
      return true;
    },
    finishNote: (key: string, saved: boolean) => {
      setEditingKey(null);
      if (saved) setSavedKey(key);
    },
    change: (next: HighlightsSearch) => {
      if (
        editingKey &&
        (next.group !== filters.group ||
          next.scope !== filters.scope ||
          !filterWorkbenchHighlights(
            items.filter((item) => item.key === editingKey),
            next,
            { assistant, missingThread },
          ).length)
      ) {
        if (!guard.canLeave()) return;
        setEditingKey(null);
      }
      setSavedKey(null);
      setSelectedKeys(new Set());
      onFiltersChange(next);
    },
    onShortcut: (event: KeyboardEvent, root: HTMLElement, toggleHelp: () => void) => {
      if (
        event.defaultPrevented ||
        event.nativeEvent.isComposing ||
        event.nativeEvent.keyCode === 229 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !(event.target instanceof Element) ||
        !root.contains(event.target) ||
        event.target.closest(
          'input, textarea, select, [contenteditable], [role="menu"], [data-slot="popover-popup"]',
        )
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "/") {
        event.preventDefault();
        root.querySelector<HTMLInputElement>("[data-highlight-search]")?.focus();
      } else if (key === "?") {
        event.preventDefault();
        toggleHelp();
      } else if (active && (key === "j" || key === "k")) {
        event.preventDefault();
        const index = ordered.indexOf(active) + (key === "j" ? 1 : -1);
        const next = ordered[Math.max(0, Math.min(ordered.length - 1, index))];
        if (next) card(next.key)?.focus();
      } else if (active && (key === "n" || key === "c" || key === "x")) {
        event.preventDefault();
        if (key === "x") toggleSelection(active.key);
        else if (key === "n" && editingKey === active.key)
          card(active.key)?.querySelector("textarea")?.focus();
        else
          card(active.key)
            ?.querySelector<HTMLButtonElement>(
              key === "n" ? "[data-highlight-add-note]" : "[data-highlight-context]",
            )
            ?.click();
      }
    },
  };
}

type WorkbenchState = ReturnType<typeof useHighlightsWorkbench>;

export function HighlightsWorkbench({
  state,
  items,
  filters,
  guard,
  compact,
  showThread,
  returnThreadKey,
  canJump,
  onInsert,
  canInsertBatch = true,
  footer,
}: {
  state: WorkbenchState;
  items: readonly WorkbenchHighlight[];
  filters: HighlightsSearch;
  guard: ReturnType<typeof useHighlightNoteGuard>;
  compact: boolean;
  showThread: boolean;
  returnThreadKey: string | null;
  canJump: (item: WorkbenchHighlight) => boolean;
  onInsert: WorkbenchInsert;
  canInsertBatch?: boolean;
  footer?: React.ReactNode;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const { groups, ordered, selected, streamRef } = state;
  const query = filters.q ?? "";
  const hasFilter = Boolean(
    query.trim() ||
    (filters.view && filters.view !== "all") ||
    (filters.source && filters.source !== "all") ||
    filters.colors?.length,
  );
  const threadLabel = (item: WorkbenchHighlight) =>
    item.thread?.title ?? gt("Archived or offline thread");
  const sourceLabel = (item: WorkbenchHighlight) =>
    item.highlight.source.kind === "markdown-file"
      ? item.highlight.source.relativePath
      : gt("Assistant message");
  const jump = async (item: WorkbenchHighlight) => {
    if (!guard.canLeave() || !canJump(item)) return;
    const { threadRef, highlight } = item;
    const { source, selector } = highlight;
    if (source.kind === "assistant-message") {
      const citation = messageHighlightCitation(threadRef, highlight);
      if (citation)
        await navigate({ ...assistantCitationNavigation(citation, null), replace: !compact });
      return;
    }
    if (!compact)
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        replace: true,
      });
    useRightPanelStore.getState().openFile(threadRef, source.relativePath);
    requestFileHighlightReveal({
      environmentId: threadRef.environmentId,
      workspaceRoot: source.workspaceRoot,
      relativePath: source.relativePath,
      selector,
    });
  };
  const recolor = (entries: readonly WorkbenchHighlight[], color: HighlightColor) => {
    if (
      entries.some((item) => item.key === state.editingKey && item.highlight.color !== color) &&
      (filters.group === "color" || (filters.colors?.length && !filters.colors.includes(color))) &&
      !guard.canLeave()
    )
      return;
    for (const group of itemsByThread(entries)) {
      useHighlightStore.getState().recolorHighlights(
        group[0]!.threadRef,
        group.map((item) => item.highlight.id),
        color,
      );
    }
  };
  const restoreFailed = () =>
    toastManager.add({ type: "warning", title: gt("Could not undo this deletion") });
  const undoToast = (title: string, restore: () => boolean) => {
    const id = toastManager.add({
      type: "info",
      title,
      actionProps: {
        children: gt("Undo"),
        onClick: () => {
          toastManager.close(id);
          if (!restore()) restoreFailed();
          streamRef.current?.focus({ preventScroll: true });
        },
      },
    });
  };
  const remove = (entries: readonly WorkbenchHighlight[]) => {
    if (entries.some((item) => item.key === state.editingKey) && !guard.canLeave()) return;
    const restore: { ref: ScopedThreadRef; removed: RemovedHighlight[] }[] = [];
    let removedCount = 0;
    for (const group of itemsByThread(entries)) {
      const ref = group[0]!.threadRef;
      const ids = new Set(group.map((item) => item.highlight.id));
      const removed = readThreadHighlights(ref).flatMap((highlight, index) =>
        ids.has(highlight.id) ? [{ highlight, index }] : [],
      );
      if (useHighlightStore.getState().removeHighlights(ref, [...ids])) {
        restore.push({ ref, removed });
        removedCount += removed.length;
      }
    }
    if (removedCount > 0) {
      state.clearSelection();
      undoToast(
        gt("{count, plural, one {Deleted # highlight} other {Deleted # highlights}}", {
          count: removedCount,
        }),
        () => {
          let restored = true;
          for (const { ref, removed } of restore) {
            if (!useHighlightStore.getState().restoreHighlights(ref, removed)) restored = false;
          }
          return restored;
        },
      );
    }
    if (removedCount < entries.length)
      toastManager.add({ type: "warning", title: gt("Could not delete all selected highlights") });
  };
  const removeNote = ({ threadRef, highlight }: WorkbenchHighlight, note: HighlightNote) => {
    const index = highlight.notes?.findIndex(({ id }) => id === note.id) ?? -1;
    if (
      index < 0 ||
      !useHighlightStore.getState().removeHighlightNote(threadRef, highlight.id, note.id)
    )
      return false;
    undoToast(gt("Deleted note"), () =>
      useHighlightStore.getState().restoreHighlightNote(threadRef, highlight.id, note, index),
    );
    return true;
  };
  const selectedKeys = new Set(selected.map(({ key }) => key));
  const positions = new Map<string, number>();
  let position = 1;
  for (const group of groups) {
    positions.set(group.key, position);
    position += group.items.length;
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
        {ordered.length > 0 && (
          <Checkbox
            aria-label={gt("Select all highlights")}
            checked={selected.length === ordered.length}
            indeterminate={selected.length > 0 && selected.length !== ordered.length}
            onCheckedChange={state.selectAll}
          />
        )}
        <span aria-live="polite">
          {ordered.length === items.length
            ? gt("{count, plural, one {# highlight} other {# highlights}}", { count: items.length })
            : gt(
                "{total, plural, one {{count} of {total} highlight} other {{count} of {total} highlights}}",
                { count: ordered.length, total: items.length },
              )}
        </span>
        {hasFilter && (
          <div className="ms-auto">
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                state.change({
                  ...(filters.scope && { scope: filters.scope }),
                  ...(filters.group && { group: filters.group }),
                })
              }
            >
              {gt("Reset filters")}
            </Button>
          </div>
        )}
      </div>
      <div
        ref={streamRef}
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {groups.length === 0 && (
          <div className="grid justify-items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            <HighlighterIcon className="size-5" />
            {hasFilter ? gt("No highlights match the filter") : gt("No highlights yet")}
          </div>
        )}
        {groups.map((group) => {
          const first = group.items[0]!;
          const file = first.highlight.source.kind === "markdown-file";
          const label = group.color
            ? m(highlightColorDefinition(group.color).label)
            : sourceLabel(first);
          const badge =
            !group.color && showThread && first.threadKey !== returnThreadKey
              ? threadLabel(first)
              : null;
          return (
            <section key={group.key} className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2 px-1">
                {group.color ? (
                  <HighlightSwatch color={group.color} />
                ) : file ? (
                  <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <MessageSquareIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                )}
                <h2 className="min-w-0 text-xs font-semibold wrap-anywhere">
                  <HighlightSearchText text={label} query={query} />
                </h2>
                {badge && (
                  <span className="min-w-0 rounded-full border bg-muted/45 px-2 text-xs text-muted-foreground wrap-anywhere">
                    <HighlightSearchText text={badge} query={query} />
                  </span>
                )}
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {group.items.length}
                </span>
              </div>
              {group.items.map((item, index) => (
                <HighlightCard
                  key={item.key}
                  item={item}
                  position={(positions.get(group.key) ?? 1) + index}
                  query={query}
                  selected={selectedKeys.has(item.key)}
                  active={!compact && item.key === state.active?.key}
                  editing={item.key === state.editingKey}
                  minimize={compact}
                  showSource={group.color !== undefined}
                  threadLabel={
                    showThread && item.threadKey !== returnThreadKey ? threadLabel(item) : null
                  }
                  sourceLabel={sourceLabel(item)}
                  canJump={canJump(item)}
                  canLeave={guard.canLeave}
                  onSelect={() => state.toggleSelection(item.key)}
                  onActivate={() => state.activate(item.key)}
                  onRecolor={(color) => recolor([item], color)}
                  onInsert={(note) =>
                    onInsert(
                      workbenchDraftContent([item], () => [note?.text]),
                      [item],
                    )
                  }
                  onJump={() => void jump(item)}
                  onDelete={() => remove([item])}
                  onDeleteNote={(note) => removeNote(item, note)}
                  onStartNote={() => state.startNote(item)}
                  onFinishNote={(saved) => state.finishNote(item.key, saved)}
                  onDirtyChange={guard.setDirty}
                />
              ))}
            </section>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div
          role="region"
          aria-label={gt("Batch actions")}
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t bg-card px-3 py-2"
        >
          <span className="text-xs font-medium">
            {gt("{count} selected", { count: selected.length })}
          </span>
          <HighlightColorPicker
            size="sm"
            ariaLabel={gt("Recolor selected highlights")}
            onChange={(color) => recolor(selected, color)}
          />
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="xs"
              disabled={!canInsertBatch}
              onClick={() => {
                const content = workbenchDraftContent(selected, (highlight) =>
                  highlight.notes?.length ? highlight.notes.map(({ text }) => text) : [undefined],
                );
                if (onInsert(content, selected)) state.clearSelection();
              }}
            >
              {gt("Merge into draft")}
            </Button>
            <Button size="xs" variant="ghost-destructive" onClick={() => remove(selected)}>
              {gt("Delete")}
            </Button>
            <Button size="xs" variant="ghost" onClick={state.clearSelection}>
              {gt("Cancel")}
            </Button>
          </div>
        </div>
      )}
      {footer}
    </div>
  );
}
