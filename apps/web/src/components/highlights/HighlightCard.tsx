import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { msg, useGT, useMessages } from "gt-react";
import { ArrowUpRightIcon, ChevronDownIcon, QuoteIcon, Trash2Icon } from "lucide-react";
import { useState, type CSSProperties } from "react";

import type { HighlightNote } from "~/highlightStore";
import { cn } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useRightPanelStore } from "~/rightPanelStore";
import { serverEnvironment } from "~/state/server";
import { selectedSmalltalkAtom, smalltalkEnvironment } from "~/state/smalltalk";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { HighlightColorPicker } from "./HighlightColorPicker";
import { HighlightNotes } from "./HighlightNotes";
import { HighlightSwatch } from "./HighlightsFilterControls";
import { splitHighlightSearchMatches, type WorkbenchHighlight } from "./highlightsWorkbench.logic";
import { highlightColorDefinition, type HighlightColor } from "~/lib/highlightColors";

export function HighlightSearchText({ text, query }: { text: string; query: string }) {
  let offset = 0;
  return splitHighlightSearchMatches(text, query).map(({ text, match }) => {
    const start = offset;
    offset += text.length;
    return match ? (
      <mark key={start} className="rounded-xs bg-(--highlight-amber)/40 text-inherit">
        {text}
      </mark>
    ) : (
      text
    );
  });
}

export function HighlightCard({
  item,
  position,
  query,
  selected,
  active,
  editing,
  showSource,
  threadLabel,
  sourceLabel,
  canJump,
  canLeave,
  minimize,
  onSelect,
  onActivate,
  onRecolor,
  onInsert,
  onJump,
  onDelete,
  onDeleteNote,
  onStartNote,
  onFinishNote,
  onDirtyChange,
}: {
  item: WorkbenchHighlight;
  position: number;
  query: string;
  selected: boolean;
  active: boolean;
  editing: boolean;
  showSource: boolean;
  threadLabel: string | null;
  sourceLabel: string;
  canJump: boolean;
  canLeave: () => boolean;
  minimize: boolean;
  onSelect: () => void;
  onActivate: () => void;
  onRecolor: (color: HighlightColor) => void;
  onInsert: (note?: HighlightNote) => void;
  onJump: () => void;
  onDelete: () => void;
  onDeleteNote: (note: HighlightNote) => boolean;
  onStartNote: () => boolean;
  onFinishNote: (saved: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const { highlight, threadRef, threadKey } = item;
  const { selector } = highlight;
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const permitted = useAtomValue(
    smalltalkEnvironment.mutate.permissionAtom(threadRef.environmentId),
  );
  const mutate = useAtomCommand(smalltalkEnvironment.mutate);
  const [explainBusy, setExplainBusy] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const definition = highlightColorDefinition(highlight.color);
  const canExplain =
    canJump &&
    config?.environment.capabilities.smalltalk === true &&
    config.environment.capabilities.smalltalkExcerptSource === true &&
    permitted;
  const explain = async (note: HighlightNote) => {
    if (explainBusy || !canLeave()) return;
    setExplainBusy(true);
    const warn = (error: unknown) =>
      toastManager.add({
        type: "warning",
        title: gt("Could not create this explanation"),
        description: thrownErrorMessage(error, m) ?? m(msg("Try again.")),
      });
    try {
      const result = await mutate({
        environmentId: threadRef.environmentId,
        input: {
          action: "create",
          threadId: threadRef.threadId,
          source: { kind: "highlight-note", noteId: note.id, text: note.text },
        },
      });
      if (result._tag === "Failure") {
        warn(squashAtomCommandFailure(result));
      } else if (result.value && canLeave()) {
        if (!minimize)
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(threadRef),
            replace: true,
          });
        appAtomRegistry.set(selectedSmalltalkAtom(threadKey), result.value.id);
        useRightPanelStore.getState().open(threadRef, "smalltalk");
      }
    } catch (error) {
      warn(error);
    }
    setExplainBusy(false);
  };
  return (
    <article
      data-highlight-card=""
      data-highlight-key={item.key}
      tabIndex={-1}
      onFocus={onActivate}
      className={cn(
        "relative flex min-w-0 scroll-my-2 flex-col gap-2.5 rounded-xl border bg-card p-3 ps-4 shadow-xs outline-none before:absolute before:inset-y-3 before:start-0 before:w-[3px] before:rounded-e-sm before:bg-(--passage-pigment) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        (selected || active) && "border-ring/65",
        !minimize && "p-4 ps-5",
      )}
      style={{ "--passage-pigment": `var(${definition.cssVariable})` } as CSSProperties}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          aria-label={gt("Select highlight {position}: {quote}", {
            position,
            quote: selector.text.slice(0, 60),
          })}
        />
        <Popover open={colorOpen} onOpenChange={setColorOpen}>
          <PopoverTrigger
            render={
              <Button
                size="xs"
                variant="outline"
                aria-label={gt("Set color for highlight {position}", { position })}
              />
            }
          >
            <HighlightSwatch color={highlight.color} />
            {m(definition.label)}
            <ChevronDownIcon />
          </PopoverTrigger>
          <PopoverPopup align="start" padding="compact">
            <div className="space-y-1.5">
              <div className="text-xs font-medium">{gt("Highlight color")}</div>
              <HighlightColorPicker
                value={highlight.color}
                onChange={(color) => {
                  onRecolor(color);
                  setColorOpen(false);
                }}
              />
            </div>
          </PopoverPopup>
        </Popover>
        {showSource && (
          <span className="min-w-0 text-xs text-muted-foreground wrap-anywhere">
            <HighlightSearchText text={sourceLabel} query={query} />
          </span>
        )}
        {threadLabel && (
          <span className="min-w-0 max-w-48 rounded-full border bg-muted/45 px-2 py-0.5 text-xs text-muted-foreground wrap-anywhere">
            <HighlightSearchText text={threadLabel} query={query} />
          </span>
        )}
        <time className="text-xs text-muted-foreground" dateTime={highlight.createdAt}>
          {formatRelativeTimeLabel(highlight.createdAt, undefined, m)}
        </time>
        <div className="ms-auto flex flex-wrap items-center gap-0.5">
          {(selector.prefix || selector.suffix) && (
            <Button
              size="xs"
              variant={contextOpen ? "secondary" : "ghost-muted"}
              data-highlight-context=""
              aria-expanded={contextOpen}
              onClick={() => setContextOpen(!contextOpen)}
            >
              {gt("Context")}
            </Button>
          )}
          <Button size="xs" variant="ghost-muted" onClick={() => onInsert()}>
            <QuoteIcon />
            {gt("Cite")}
          </Button>
          {showSource && (
            <Button size="xs" variant="ghost-muted" disabled={!canJump} onClick={onJump}>
              <ArrowUpRightIcon />
              {gt("Jump to source")}
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost-destructive"
            aria-label={gt("Delete highlight {position}", { position })}
            onClick={onDelete}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-foreground">
        {contextOpen && (
          <span className="text-muted-foreground">
            <HighlightSearchText text={selector.prefix} query={query} />
          </span>
        )}
        <mark className="box-decoration-clone rounded-sm bg-(--passage-pigment)/20 px-0.5 text-inherit">
          <HighlightSearchText text={selector.text} query={query} />
        </mark>
        {contextOpen && (
          <span className="text-muted-foreground">
            <HighlightSearchText text={selector.suffix} query={query} />
          </span>
        )}
      </p>
      <div className="border-t border-border/60 pt-2">
        <HighlightNotes
          threadRef={threadRef}
          highlight={highlight}
          inlineEditor={{ active: editing, position, start: onStartNote, finish: onFinishNote }}
          onDirtyChange={onDirtyChange}
          onInsert={onInsert}
          onExplain={canExplain ? (note) => void explain(note) : undefined}
          explainBusy={explainBusy}
          onRequestDeleteNote={onDeleteNote}
          renderNoteText={(text) => <HighlightSearchText text={text} query={query} />}
        />
      </div>
    </article>
  );
}
