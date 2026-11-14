import { useNavigate } from "@tanstack/react-router";
import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";
import { HighlighterIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { requestFileHighlightReveal } from "~/fileHighlightRevealStore";
import {
  useHighlightStore,
  useThreadHighlights,
  type MarkdownFileHighlightExcerpt,
  type ThreadHighlight,
} from "~/highlightStore";
import { assistantCitationNavigation } from "~/lib/assistantCitationNavigation";
import { HIGHLIGHT_COLORS, type HighlightColorDefinition } from "~/lib/highlightColors";
import { useRightPanelStore } from "~/rightPanelStore";
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
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

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

  const messageHighlights = highlights.filter(
    (highlight) => highlight.source.kind === "assistant-message",
  );
  const fileHighlights = highlights.filter(
    (highlight) => highlight.source.kind === "markdown-file",
  );
  const activeHighlights = tab === "messages" ? messageHighlights : fileHighlights;
  const groups = groupedHighlights(activeHighlights, tab);
  const orderedHighlights = groups.flatMap((group) => group.highlights);
  const exists = new Set(activeHighlights.map((highlight) => highlight.id));
  const positionById = new Map(
    orderedHighlights.map((highlight, index) => [highlight.id, index + 1]),
  );
  const selected = orderedHighlights.filter((highlight) => selectedIds.has(highlight.id));
  const allSelected = activeHighlights.length > 0 && selected.length === activeHighlights.length;
  const someSelected = selected.length > 0 && !allSelected;

  const selectTab = (next: HighlightTab) => {
    if (next === tab) return;
    setTab(next);
    setSelectedIds(new Set());
    setConfirmDeleteOpen(false);
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
  const recolor = (highlight: ThreadHighlight, color: HighlightColorDefinition) => {
    useHighlightStore.getState().recolorHighlight(threadRef, highlight.id, color.id);
  };
  const removeOne = (highlight: ThreadHighlight) => {
    useHighlightStore.getState().removeHighlights(threadRef, [highlight.id]);
  };

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
          {activeHighlights.length} {activeHighlights.length === 1 ? "highlight" : "highlights"}
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
      {activeHighlights.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <HighlighterIcon aria-hidden className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {highlights.length === 0
              ? "No highlights yet"
              : tab === "messages"
                ? "No message highlights yet"
                : "No Markdown highlights yet"}
          </p>
          <p className="max-w-64 text-xs text-muted-foreground">
            {tab === "messages"
              ? "Select text in an assistant message and choose Highlight."
              : "Select text in a rendered Markdown file and choose Highlight."}
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
                            aria-label={`Highlight actions for highlight ${position}`}
                            size="icon-xs"
                            variant="ghost"
                            type="button"
                          />
                        }
                      >
                        <MoreHorizontalIcon className="size-3.5" />
                      </MenuTrigger>
                      <MenuPopup align="end" sideOffset={4}>
                        <MenuRadioGroup
                          value={highlight.color}
                          onValueChange={(value) => {
                            const color = HIGHLIGHT_COLORS.find((entry) => entry.id === value);
                            if (color) recolor(highlight, color);
                          }}
                        >
                          {HIGHLIGHT_COLORS.map((color) => (
                            <MenuRadioItem key={color.id} value={color.id}>
                              <ColorDot color={color} />
                              <span className="flex-1">{color.label}</span>
                              <MenuRadioItemIndicator />
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                        <MenuItem onClick={() => removeOne(highlight)}>
                          <Trash2Icon aria-hidden className="size-3.5" />
                          Delete
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
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
