import { useNavigate } from "@tanstack/react-router";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { HighlighterIcon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestFileHighlightReveal } from "~/fileHighlightRevealStore";
import {
  useHighlightStore,
  useThreadHighlights,
  type HighlightNote,
  type MarkdownFileHighlightExcerpt,
  type ThreadHighlight,
} from "~/highlightStore";
import {
  type HighlightInsert,
  markdownHighlightExcerpt,
  messageHighlightCitation,
} from "~/lib/highlightCitation";
import { assistantCitationNavigation } from "~/lib/assistantCitationNavigation";
import {
  HIGHLIGHT_COLORS,
  highlightColorDefinition,
  type HighlightColor,
} from "~/lib/highlightColors";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { selectedSmalltalkAtom, smalltalkEnvironment } from "../../state/smalltalk";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { HighlightColorPicker } from "../highlights/HighlightColorPicker";
import { useHighlightNoteGuard } from "../highlights/HighlightNoteSurface";
import { HighlightNotes } from "../highlights/HighlightNotes";
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
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type HighlightTab = "messages" | "files";

interface HighlightGroup {
  readonly key: string;
  readonly label: string;
  readonly highlights: ThreadHighlight[];
}

function highlightGroupIdentity(
  highlight: ThreadHighlight,
  tab: HighlightTab,
  assistantMessageLabel: string,
): { readonly key: string; readonly label: string } | null {
  if (tab === "messages") {
    return highlight.source.kind === "assistant-message"
      ? { key: highlight.source.messageId, label: assistantMessageLabel }
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
  assistantMessageLabel: string,
): HighlightGroup[] {
  const groups = new Map<string, HighlightGroup>();
  for (const highlight of [...highlights].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )) {
    const identity = highlightGroupIdentity(highlight, tab, assistantMessageLabel);
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
  const gt = useGT();
  const m = useMessages();
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
                  aria-label={gt("Set color for highlight {position}", { position })}
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
        <TooltipPopup>{m(definition.label)}</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="start" sideOffset={6} padding="compact">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium">{gt("Highlight color")}</span>
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
  readonly onInsertHighlights: HighlightInsert<readonly AssistantCitation[]>;
  readonly onInsertMarkdownFileHighlights: HighlightInsert<readonly MarkdownFileHighlightExcerpt[]>;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const highlights = useThreadHighlights(threadRef);
  const smalltalkConfig = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const smalltalkAllowed = useAtomValue(
    smalltalkEnvironment.mutate.permissionAtom(threadRef.environmentId),
  );
  const smalltalkMutate = useAtomCommand(smalltalkEnvironment.mutate);
  const selectSmalltalk = useAtomSet(selectedSmalltalkAtom(scopedThreadKey(threadRef)));
  const [creatingNoteExplanation, setCreatingNoteExplanation] = useState(false);
  const noteSmalltalkSupported =
    smalltalkConfig?.environment.capabilities.smalltalk === true &&
    smalltalkConfig.environment.capabilities.smalltalkExcerptSource === true &&
    smalltalkAllowed;
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
  const noteGuard = useHighlightNoteGuard();
  const [expandedNotesId, setExpandedNotesId] = useState<string | null>(null);

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
  const groups = groupedHighlights(filteredHighlights, tab, gt("Assistant message"));
  const orderedHighlights = groups.flatMap((group) => group.highlights);
  const exists = new Set(orderedHighlights.map((highlight) => highlight.id));
  const positionById = new Map(
    orderedHighlights.map((highlight, index) => [highlight.id, index + 1]),
  );
  const selected = orderedHighlights.filter((highlight) => selectedIds.has(highlight.id));
  const allSelected = orderedHighlights.length > 0 && selected.length === orderedHighlights.length;
  const someSelected = selected.length > 0 && !allSelected;

  const selectTab = (next: HighlightTab) => {
    if (next === tab || !noteGuard.canLeave()) return;
    setTab(next);
    setSelectedIds(new Set());
    setConfirmDeleteOpen(false);
    setColorPopoverId(null);
    setExpandedNotesId(null);
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
    const next = new Set(colorFilter);
    if (next.has(color)) next.delete(color);
    else next.add(color);
    const expanded = activeHighlights.find((highlight) => highlight.id === expandedNotesId);
    if (expanded && next.size > 0 && !next.has(expanded.color) && !noteGuard.canLeave()) return;
    setColorFilter(next);
  };
  const toggleNotes = (id: string) => {
    if (noteGuard.canLeave()) setExpandedNotesId(expandedNotesId === id ? null : id);
  };
  const jumpTo = (highlight: ThreadHighlight) => {
    if (!noteGuard.canLeave()) return;
    if (highlight.source.kind === "assistant-message") {
      const citation = messageHighlightCitation(threadRef, highlight);
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
        const citation = messageHighlightCitation(threadRef, highlight);
        return citation === null ? [] : [citation];
      });
      if (citations.length > 0 && onInsertHighlights(citations)) {
        setSelectedIds(new Set());
      }
      return;
    }
    const excerpts = selected.flatMap((highlight) => markdownHighlightExcerpt(highlight) ?? []);
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
    if (
      selected.length === 0 ||
      (expandedNotesId && selectedIds.has(expandedNotesId) && !noteGuard.canLeave())
    )
      return;
    if (selected.length === 1) {
      removeSelected();
      return;
    }
    setConfirmDeleteOpen(true);
  };
  const recolor = (highlight: ThreadHighlight, color: HighlightColor) => {
    if (
      highlight.id === expandedNotesId &&
      colorFilter.size > 0 &&
      !colorFilter.has(color) &&
      !noteGuard.canLeave()
    )
      return;
    useHighlightStore.getState().recolorHighlight(threadRef, highlight.id, color);
  };
  const removeOne = (highlight: ThreadHighlight) => {
    if (highlight.id === expandedNotesId && !noteGuard.canLeave()) return;
    useHighlightStore.getState().removeHighlights(threadRef, [highlight.id]);
  };
  const insertNote = (highlight: ThreadHighlight, note: HighlightNote) => {
    const citation = messageHighlightCitation(threadRef, highlight, note.text);
    if (citation) return onInsertHighlights([citation], "chat-draft");
    const excerpt = markdownHighlightExcerpt(highlight, note.text);
    return excerpt !== null && onInsertMarkdownFileHighlights([excerpt], "chat-draft");
  };
  const explainNote = (note: HighlightNote) => {
    if (creatingNoteExplanation) return;
    setCreatingNoteExplanation(true);
    void smalltalkMutate({
      environmentId: threadRef.environmentId,
      input: {
        action: "create",
        threadId: threadRef.threadId,
        source: { kind: "highlight-note", noteId: note.id, text: note.text },
      },
    })
      .then((result) => {
        if (result._tag === "Failure") {
          toastManager.add({
            type: "warning",
            title: gt("Could not create this explanation"),
            description:
              thrownErrorMessage(squashAtomCommandFailure(result), m) ?? m(msg("Try again.")),
          });
          return;
        }
        if (result.value) {
          selectSmalltalk(result.value.id);
          useRightPanelStore.getState().open(threadRef, "smalltalk");
        }
      })
      .finally(() => setCreatingNoteExplanation(false));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 px-3 py-2">
        <ToggleGroup
          aria-label={gt("Highlight source")}
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "messages" || value === "files") selectTab(value);
          }}
        >
          <Toggle value="messages">{gt("Messages")}</Toggle>
          <Toggle value="files">{gt("Markdown files")}</Toggle>
        </ToggleGroup>
      </div>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Checkbox
          aria-label={gt("Select all highlights")}
          checked={allSelected}
          indeterminate={someSelected}
          onCheckedChange={(checked) => setAllSelected(checked === true)}
        />
        <span className="text-xs text-muted-foreground">
          {colorFilter.size === 0 || activeHighlights.length === 0
            ? gt("{count, plural, one {{count} highlight} other {{count} highlights}}", {
                count: activeHighlights.length,
              })
            : gt(
                "{total, plural, one {{count} of {total} highlight} other {{count} of {total} highlights}}",
                { count: filteredHighlights.length, total: activeHighlights.length },
              )}
        </span>
        {activeHighlights.length > 0 ? (
          <div
            className="ml-auto flex items-center gap-1.5"
            role="group"
            aria-label={gt("Filter by color")}
          >
            {HIGHLIGHT_COLORS.map((color) => {
              const count = countByColor.get(color.id) ?? 0;
              const active = colorFilter.has(color.id);
              const label = m(color.label);
              return (
                <Tooltip key={color.id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={gt("Filter {color}", { color: label })}
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
                    {count === 0
                      ? gt("{color} (none here)", { color: label })
                      : gt("{color} ({count})", { color: label, count })}
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </div>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <div className="flex items-center gap-1 border-b border-border/60 px-3 py-1.5">
          <span className="text-2xs text-muted-foreground">
            {gt("{count} selected", { count: selected.length })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="xs" variant="outline" onClick={insertSelected}>
              {gt("Insert into chat")}
            </Button>
            <Button size="xs" variant="ghost-destructive" onClick={requestDelete}>
              {gt("Delete", { $context: "verb, deletes highlights" })}
            </Button>
          </div>
        </div>
      ) : null}
      {orderedHighlights.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <HighlighterIcon aria-hidden className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {highlights.length === 0
              ? gt("No highlights yet")
              : activeHighlights.length === 0
                ? tab === "messages"
                  ? gt("No message highlights yet")
                  : gt("No Markdown highlights yet")
                : gt("No highlights match the filter")}
          </p>
          <p className="max-w-64 text-xs text-muted-foreground">
            {highlights.length === 0 || activeHighlights.length === 0
              ? tab === "messages"
                ? gt("Select text in an assistant message and choose Highlight.")
                : gt("Select text in a rendered Markdown file and choose Highlight.")
              : gt("Click a color dot again to turn its filter off.")}
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
                const expanded = expandedNotesId === highlight.id;
                const preview = highlight.notes?.[0];
                const count = highlight.notes?.length ?? 0;
                return (
                  <div
                    key={highlight.id}
                    className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
                  >
                    <Checkbox
                      aria-label={gt("Select highlight {position}: {text}", {
                        position,
                        text: highlight.selector.text.slice(0, 60),
                      })}
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
                      {expanded ? (
                        <div
                          className="mt-2 border-s-2 ps-2"
                          style={{
                            borderColor: `var(${highlightColorDefinition(highlight.color).cssVariable})`,
                          }}
                        >
                          <HighlightNotes
                            threadRef={threadRef}
                            highlight={highlight}
                            onDirtyChange={noteGuard.setDirty}
                            onInsert={(note) => insertNote(highlight, note)}
                            onExplain={noteSmalltalkSupported ? explainNote : undefined}
                            explainBusy={creatingNoteExplanation}
                          />
                        </div>
                      ) : null}
                      {preview ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          className="mt-1 flex w-full min-w-0 cursor-pointer items-start gap-1.5 rounded-sm text-start text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={() => toggleNotes(highlight.id)}
                        >
                          <StickyNoteIcon aria-hidden className="mt-px size-3 shrink-0" />
                          <span className="shrink-0">
                            {gt("Notes ({count, number})", { count })}
                          </span>
                          {!expanded ? <span className="truncate">{preview.text}</span> : null}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {!preview ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                aria-label={gt("Add note for highlight {position}", { position })}
                                aria-expanded={expanded}
                                size="icon-xs"
                                variant="ghost"
                                onClick={() => toggleNotes(highlight.id)}
                              />
                            }
                          >
                            <StickyNoteIcon aria-hidden className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipPopup>{gt("Add note")}</TooltipPopup>
                        </Tooltip>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              aria-label={gt("Delete highlight {position}", { position })}
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => removeOne(highlight)}
                            />
                          }
                        >
                          <Trash2Icon aria-hidden className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipPopup>
                          {gt("Delete", { $context: "verb, deletes highlights" })}
                        </TooltipPopup>
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
            <DialogTitle>
              {gt("Delete {count} highlights?", { count: selected.length })}
            </DialogTitle>
            <DialogDescription>{gt("This cannot be undone.")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
              {gt("Cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={removeSelected}>
              {gt("Delete", { $context: "verb, deletes highlights" })}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
