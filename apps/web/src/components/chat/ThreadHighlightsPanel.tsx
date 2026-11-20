import { useNavigate } from "@tanstack/react-router";
import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";
import { HighlighterIcon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestFileHighlightReveal } from "~/fileHighlightRevealStore";
import {
  MAX_HIGHLIGHT_NOTE_LENGTH,
  useHighlightStore,
  useThreadHighlights,
  type MarkdownFileHighlightExcerpt,
  type ThreadHighlight,
} from "~/highlightStore";
import { assistantCitationNavigation } from "~/lib/assistantCitationNavigation";
import {
  HIGHLIGHT_COLORS,
  highlightColorDefinition,
  type HighlightColor,
} from "~/lib/highlightColors";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { HighlightColorPicker } from "../highlights/HighlightColorPicker";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type HighlightTab = "messages" | "files";

interface HighlightGroup {
  readonly key: string;
  readonly label: string;
  readonly highlights: ThreadHighlight[];
}

function messageCitationOf(
  threadRef: ScopedThreadRef,
  highlight: ThreadHighlight,
): AssistantCitation | null {
  if (highlight.source.kind !== "assistant-message") return null;
  return {
    version: 1,
    ...threadRef,
    messageId: highlight.source.messageId,
    ...highlight.selector,
    ...(highlight.note !== undefined ? { comment: highlight.note } : {}),
  };
}

function highlightGroupIdentity(
  highlight: ThreadHighlight,
  tab: HighlightTab,
): { readonly key: string; readonly label: string } | null {
  if (tab === "messages") {
    return highlight.source.kind === "assistant-message"
      ? { key: highlight.source.messageId, label: "Assistant message" }
      : null;
  }
  return highlight.source.kind === "markdown-file"
    ? {
        key: `${highlight.source.workspaceRoot}\u0000${highlight.source.relativePath}`,
        label: highlight.source.relativePath,
      }
    : null;
}

function groupedHighlights(
  highlights: readonly ThreadHighlight[],
  tab: HighlightTab,
): HighlightGroup[] {
  const groups = new Map<string, HighlightGroup>();
  for (const highlight of [...highlights].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )) {
    const identity = highlightGroupIdentity(highlight, tab);
    if (identity === null) continue;
    const group = groups.get(identity.key);
    if (group) group.highlights.push(highlight);
    else groups.set(identity.key, { ...identity, highlights: [highlight] });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    highlights: group.highlights.sort((left, right) => left.selector.start - right.selector.start),
  }));
}

function HighlightRowColorTrigger({
  highlight,
  position,
  open,
  onOpenChange,
  onRecolor,
}: {
  readonly highlight: ThreadHighlight;
  readonly position: number;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRecolor: (color: HighlightColor) => void;
}) {
  const definition = highlightColorDefinition(highlight.color);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={`Set color for highlight ${position}`}
                  className="mt-0.5 grid size-5 shrink-0 cursor-pointer place-items-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <span
                aria-hidden
                className="size-3.5 rounded-full border border-border"
                style={{ backgroundColor: `var(${definition.cssVariable})` }}
              />
            </PopoverTrigger>
          }
        />
        <TooltipPopup>{definition.label}</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="start" sideOffset={6} padding="compact">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">Highlight color</span>
          <HighlightColorPicker
            value={highlight.color}
            onChange={(color) => {
              onRecolor(color);
              onOpenChange(false);
            }}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function ThreadHighlightsPanel({
  threadRef,
  onInsertHighlights,
  onInsertMarkdownFileHighlights,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onInsertHighlights: (citations: readonly AssistantCitation[]) => boolean;
  readonly onInsertMarkdownFileHighlights: (
    excerpts: readonly MarkdownFileHighlightExcerpt[],
  ) => boolean;
}) {
  const navigate = useNavigate();
  const highlights = useThreadHighlights(threadRef);
  const [tab, setTab] = useState<HighlightTab>(() =>
    highlights.length > 0 &&
    highlights.every((highlight) => highlight.source.kind === "markdown-file")
      ? "files"
      : "messages",
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [colorFilter, setColorFilter] = useState<ReadonlySet<HighlightColor>>(() => new Set());
  const [colorPopoverId, setColorPopoverId] = useState<string | null>(null);
  const [noteEditor, setNoteEditor] = useState<{ id: string; draft: string } | null>(null);

  const messageHighlights = highlights.filter(
    (highlight) => highlight.source.kind === "assistant-message",
  );
  const fileHighlights = highlights.filter(
    (highlight) => highlight.source.kind === "markdown-file",
  );
  const activeHighlights = tab === "messages" ? messageHighlights : fileHighlights;
  const filteredHighlights = activeHighlights.filter(
    (highlight) => colorFilter.size === 0 || colorFilter.has(highlight.color),
  );
  const countByColor = new Map<HighlightColor, number>();
  for (const highlight of activeHighlights) {
    countByColor.set(highlight.color, (countByColor.get(highlight.color) ?? 0) + 1);
  }
  const groups = groupedHighlights(filteredHighlights, tab);
  const orderedHighlights = groups.flatMap((group) => group.highlights);
  const exists = new Set(orderedHighlights.map((highlight) => highlight.id));
  const positionById = new Map(
    orderedHighlights.map((highlight, index) => [highlight.id, index + 1]),
  );
  const selected = orderedHighlights.filter((highlight) => selectedIds.has(highlight.id));
  const allSelected = orderedHighlights.length > 0 && selected.length === orderedHighlights.length;
  const someSelected = selected.length > 0 && !allSelected;

  const selectTab = (next: HighlightTab) => {
    if (next === tab) return;
    setTab(next);
    setSelectedIds(new Set());
    setConfirmDeleteOpen(false);
    setColorPopoverId(null);
    setNoteEditor(null);
  };
  const setSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const setAllSelected = (checked: boolean) => {
    setSelectedIds(
      checked ? new Set(orderedHighlights.map((highlight) => highlight.id)) : new Set(),
    );
  };
  const toggleColorFilter = (color: HighlightColor) => {
    setColorFilter((current) => {
      const next = new Set(current);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  };
  const jumpTo = (highlight: ThreadHighlight) => {
    if (highlight.source.kind === "assistant-message") {
      const citation = messageCitationOf(threadRef, highlight);
      if (citation) void navigate(assistantCitationNavigation(citation, null));
      return;
    }
    useRightPanelStore.getState().openFile(threadRef, highlight.source.relativePath);
    requestFileHighlightReveal({
      environmentId: threadRef.environmentId,
      workspaceRoot: highlight.source.workspaceRoot,
      relativePath: highlight.source.relativePath,
      selector: highlight.selector,
    });
  };
  const insertSelected = () => {
    if (selected.length === 0) return;
    if (tab === "messages") {
      const citations = selected.flatMap((highlight) => {
        const citation = messageCitationOf(threadRef, highlight);
        return citation === null ? [] : [citation];
      });
      if (citations.length > 0 && onInsertHighlights(citations)) {
        setSelectedIds(new Set());
      }
      return;
    }
    const excerpts = selected.flatMap((highlight) =>
      highlight.source.kind === "markdown-file"
        ? [
            {
              workspaceRoot: highlight.source.workspaceRoot,
              relativePath: highlight.source.relativePath,
              text: highlight.selector.text,
            },
          ]
        : [],
    );
    if (excerpts.length > 0 && onInsertMarkdownFileHighlights(excerpts)) {
      setSelectedIds(new Set());
    }
  };
  const removeSelected = () => {
    useHighlightStore.getState().removeHighlights(
      threadRef,
      selected.map((highlight) => highlight.id),
    );
    setSelectedIds(new Set());
    setConfirmDeleteOpen(false);
  };
  const requestDelete = () => {
    if (selected.length === 0) return;
    if (selected.length === 1) {
      removeSelected();
      return;
    }
    setConfirmDeleteOpen(true);
  };
  const recolor = (highlight: ThreadHighlight, color: HighlightColor) => {
    useHighlightStore.getState().recolorHighlight(threadRef, highlight.id, color);
  };
  const removeOne = (highlight: ThreadHighlight) => {
    useHighlightStore.getState().removeHighlights(threadRef, [highlight.id]);
  };
  const noteTooLong = (noteEditor?.draft.length ?? 0) > MAX_HIGHLIGHT_NOTE_LENGTH;
  const saveNote = () => {
    if (noteEditor === null || noteTooLong) return;
    useHighlightStore.getState().setHighlightNote(threadRef, noteEditor.id, noteEditor.draft);
    setNoteEditor(null);
  };
  const cancelNote = () => setNoteEditor(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 px-3 py-2">
        <ToggleGroup
          aria-label="Highlight source"
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "messages" || value === "files") selectTab(value);
          }}
        >
          <Toggle value="messages">Messages</Toggle>
          <Toggle value="files">Markdown files</Toggle>
        </ToggleGroup>
      </div>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Checkbox
          aria-label="Select all highlights"
          checked={allSelected}
          indeterminate={someSelected}
          onCheckedChange={(checked) => setAllSelected(checked === true)}
        />
        <span className="text-xs text-muted-foreground">
          {colorFilter.size === 0 || activeHighlights.length === 0
            ? `${activeHighlights.length} ${activeHighlights.length === 1 ? "highlight" : "highlights"}`
            : `${filteredHighlights.length} of ${activeHighlights.length} ${activeHighlights.length === 1 ? "highlight" : "highlights"}`}
        </span>
        {activeHighlights.length > 0 ? (
          <div
            className="ml-auto flex items-center gap-1.5"
            role="group"
            aria-label="Filter by color"
          >
            {HIGHLIGHT_COLORS.map((color) => {
              const count = countByColor.get(color.id) ?? 0;
              const active = colorFilter.has(color.id);
              return (
                <Tooltip key={color.id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Filter ${color.label}`}
                        aria-pressed={active}
                        disabled={count === 0 && !active}
                        onClick={() => toggleColorFilter(color.id)}
                        className={cn(
                          "size-3 rounded-full outline-none transition-[opacity,box-shadow] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          count === 0 && !active
                            ? "opacity-20"
                            : active
                              ? "ring-2 ring-ring ring-offset-1 ring-offset-background"
                              : "opacity-40 hover:opacity-80",
                        )}
                        style={{ backgroundColor: `var(${color.cssVariable})` }}
                      />
                    }
                  />
                  <TooltipPopup>
                    {count === 0 ? `${color.label} (none here)` : `${color.label} (${count})`}
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </div>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <div className="flex items-center gap-1 border-b border-border/60 px-3 py-1.5">
          <span className="text-2xs text-muted-foreground">{selected.length} selected</span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="xs" variant="outline" onClick={insertSelected}>
              Insert into chat
            </Button>
            <Button size="xs" variant="ghost-destructive" onClick={requestDelete}>
              Delete
            </Button>
          </div>
        </div>
      ) : null}
      {orderedHighlights.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <HighlighterIcon aria-hidden className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {highlights.length === 0
              ? "No highlights yet"
              : activeHighlights.length === 0
                ? tab === "messages"
                  ? "No message highlights yet"
                  : "No Markdown highlights yet"
                : "No highlights match the filter"}
          </p>
          <p className="max-w-64 text-xs text-muted-foreground">
            {highlights.length === 0 || activeHighlights.length === 0
              ? tab === "messages"
                ? "Select text in an assistant message and choose Highlight."
                : "Select text in a rendered Markdown file and choose Highlight."
              : "Click a color dot again to turn its filter off."}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map((group) => (
            <div key={group.key} className="mb-2 last:mb-0">
              <div className="truncate px-2 py-1 text-2xs font-medium text-muted-foreground">
                {group.label}
              </div>
              {group.highlights.map((highlight) => {
                const position = positionById.get(highlight.id) ?? 0;
                const editing = noteEditor?.id === highlight.id;
                return (
                  <div
                    key={highlight.id}
                    className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
                  >
                    <Checkbox
                      aria-label={`Select highlight ${position}: ${highlight.selector.text.slice(0, 60)}`}
                      checked={selectedIds.has(highlight.id) && exists.has(highlight.id)}
                      className="mt-0.5"
                      onCheckedChange={(checked) => setSelected(highlight.id, checked === true)}
                    />
                    <HighlightRowColorTrigger
                      highlight={highlight}
                      position={position}
                      open={colorPopoverId === highlight.id}
                      onOpenChange={(open) => setColorPopoverId(open ? highlight.id : null)}
                      onRecolor={(color) => recolor(highlight, color)}
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="cursor-pointer text-left"
                        onClick={() => jumpTo(highlight)}
                      >
                        <span className="line-clamp-3 text-sm text-foreground">
                          {highlight.selector.text}
                        </span>
                      </button>
                      {editing ? (
                        <div className="mt-1.5">
                          <textarea
                            autoFocus
                            aria-label={`Note editor for highlight ${position}`}
                            placeholder="Add a note for this highlight..."
                            rows={2}
                            className="field-sizing-content max-h-32 min-h-9 w-full resize-none rounded-md border border-border bg-background/50 px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
                            value={noteEditor.draft}
                            onChange={(event) =>
                              setNoteEditor({ id: highlight.id, draft: event.currentTarget.value })
                            }
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.nativeEvent.isComposing) return;
                              if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                saveNote();
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                cancelNote();
                              }
                            }}
                          />
                          {noteTooLong ? (
                            <p role="status" className="pt-1 text-xs text-destructive">
                              Notes can contain up to {MAX_HIGHLIGHT_NOTE_LENGTH.toLocaleString()}{" "}
                              characters.
                            </p>
                          ) : null}
                          <div className="mt-1 flex items-center justify-end gap-1">
                            <Button size="xs" variant="ghost" onClick={cancelNote}>
                              Cancel
                            </Button>
                            <Button size="xs" onClick={saveNote} disabled={noteTooLong}>
                              {noteTooLong ? "Shorten note" : "Save note"}
                            </Button>
                          </div>
                        </div>
                      ) : highlight.note !== undefined ? (
                        <span
                          className="mt-1 block whitespace-pre-wrap break-words border-l-2 pl-2 text-xs text-muted-foreground"
                          style={{
                            borderColor: `var(${highlightColorDefinition(highlight.color).cssVariable})`,
                          }}
                        >
                          {highlight.note}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              aria-label={`${highlight.note === undefined ? "Add note" : "Edit note"} for highlight ${position}`}
                              size="icon-xs"
                              variant="ghost"
                              onClick={() =>
                                setNoteEditor({ id: highlight.id, draft: highlight.note ?? "" })
                              }
                            />
                          }
                        >
                          <StickyNoteIcon aria-hidden className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup>
                          {highlight.note === undefined ? "Add note" : "Edit note"}
                        </TooltipPopup>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              aria-label={`Delete highlight ${position}`}
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => removeOne(highlight)}
                            />
                          }
                        >
                          <Trash2Icon aria-hidden className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup>Delete</TooltipPopup>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Delete {selected.length} highlights?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={removeSelected}>
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
