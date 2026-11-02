import { useNavigate } from "@tanstack/react-router";
import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, HighlighterIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { assistantCitationNavigation } from "~/lib/assistantCitationNavigation";
import { HIGHLIGHT_COLORS, type HighlightColorDefinition } from "~/lib/highlightColors";
import { useHighlightStore, useThreadHighlights, type ThreadHighlight } from "~/highlightStore";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

function citationOf(threadRef: ScopedThreadRef, highlight: ThreadHighlight): AssistantCitation {
  return {
    version: 1,
    ...threadRef,
    messageId: highlight.messageId,
    ...highlight.selector,
  };
}

function ColorDot({ color }: { color: HighlightColorDefinition }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: `var(${color.cssVariable})` }}
    />
  );
}

export function ThreadHighlightsPanel({
  threadRef,
  onInsertHighlights,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onInsertHighlights: (citations: readonly AssistantCitation[]) => boolean;
}) {
  const navigate = useNavigate();
  const highlights = useThreadHighlights(threadRef);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const exists = new Set(highlights.map((highlight) => highlight.id));
  const selected = highlights.filter((highlight) => selectedIds.has(highlight.id));
  const allSelected = highlights.length > 0 && selected.length === highlights.length;
  const someSelected = selected.length > 0 && !allSelected;

  const groups: { messageId: string; highlights: ThreadHighlight[] }[] = [];
  for (const highlight of [...highlights].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )) {
    const group = groups.at(-1);
    if (group?.messageId === highlight.messageId) group.highlights.push(highlight);
    else groups.push({ messageId: highlight.messageId, highlights: [highlight] });
  }
  for (const group of groups) {
    group.highlights.sort((left, right) => left.selector.start - right.selector.start);
  }

  const setSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const setAllSelected = (checked: boolean) => {
    setSelectedIds(checked ? new Set(highlights.map((highlight) => highlight.id)) : new Set());
  };
  const jumpTo = (highlight: ThreadHighlight) => {
    void navigate(assistantCitationNavigation(citationOf(threadRef, highlight)));
  };
  const insertSelected = () => {
    if (selected.length === 0) return;
    if (onInsertHighlights(selected.map((highlight) => citationOf(threadRef, highlight)))) {
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
  const recolor = (highlight: ThreadHighlight, color: HighlightColorDefinition) => {
    useHighlightStore.getState().recolorHighlight(threadRef, highlight.id, color.id);
  };
  const removeOne = (highlight: ThreadHighlight) => {
    useHighlightStore.getState().removeHighlights(threadRef, [highlight.id]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Checkbox
          aria-label="Select all highlights"
          checked={allSelected}
          indeterminate={someSelected}
          onCheckedChange={(checked) => setAllSelected(checked === true)}
        />
        <span className="text-xs text-muted-foreground">
          {highlights.length} {highlights.length === 1 ? "highlight" : "highlights"}
        </span>
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
      {highlights.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <HighlighterIcon aria-hidden className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No highlights yet</p>
          <p className="max-w-64 text-xs text-muted-foreground">
            Select text in an assistant message and choose Highlight.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map((group) => (
            <div key={group.messageId} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-2xs font-medium text-muted-foreground">
                Assistant message
              </div>
              {group.highlights.map((highlight) => (
                <div
                  key={highlight.id}
                  className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40"
                >
                  <Checkbox
                    aria-label={`Select highlight: ${highlight.selector.text.slice(0, 60)}`}
                    checked={selectedIds.has(highlight.id) && exists.has(highlight.id)}
                    className="mt-0.5"
                    onCheckedChange={(checked) => setSelected(highlight.id, checked === true)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    onClick={() => jumpTo(highlight)}
                  >
                    <span className="flex items-start gap-2">
                      <span className="mt-1">
                        <ColorDot
                          color={
                            HIGHLIGHT_COLORS.find((color) => color.id === highlight.color) ??
                            HIGHLIGHT_COLORS[0]!
                          }
                        />
                      </span>
                      <span className="line-clamp-3 text-sm text-foreground">
                        {highlight.selector.text}
                      </span>
                    </span>
                  </button>
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          aria-label="Highlight actions"
                          size="icon-xs"
                          variant="ghost"
                          type="button"
                        />
                      }
                    >
                      <MoreHorizontalIcon className="size-3.5" />
                    </MenuTrigger>
                    <MenuPopup align="end" sideOffset={4}>
                      {HIGHLIGHT_COLORS.map((color) => (
                        <MenuItem key={color.id} onClick={() => recolor(highlight, color)}>
                          <ColorDot color={color} />
                          <span className="flex-1">{color.label}</span>
                          {highlight.color === color.id ? (
                            <CheckIcon aria-hidden className="size-3.5" />
                          ) : null}
                        </MenuItem>
                      ))}
                      <MenuItem onClick={() => removeOne(highlight)}>
                        <Trash2Icon aria-hidden className="size-3.5" />
                        Delete
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                </div>
              ))}
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
