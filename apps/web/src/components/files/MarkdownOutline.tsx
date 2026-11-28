import { useGT } from "gt-react";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ListTreeIcon,
  PanelLeftCloseIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Kbd } from "~/components/ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { RightPanelResizeHandle } from "~/components/preview/RightPanelResizeHandle";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import type { MessageOutlineHeading } from "../chat/messageOutline";
import { FileSurfaceAction } from "./fileSurfaceChrome";
import {
  MARKDOWN_OUTLINE_FILTER_THRESHOLD,
  filterOutlineHeadings,
  resolveVisibleActiveHeadingIndex,
  resolveVisualOutlineDepth,
  selectVisibleOutlineHeadings,
} from "./markdownOutline.logic";
import type { MarkdownOutlineController } from "./useMarkdownOutline";

const SIDEBAR_STORAGE_KEY = "t3code.markdownOutlineWidth";
const SIDEBAR_DEFAULT_WIDTH = 224;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 340;
const MARKDOWN_BODY_MIN_WIDTH = 360;

function OutlineDepthToggleButton(props: {
  readonly showAllLevels: boolean;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  const label = props.showAllLevels ? gt("Show top 3 levels") : gt("Show all heading levels");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={props.showAllLevels}
            onClick={props.onToggle}
          />
        }
      >
        {props.showAllLevels ? (
          <ChevronsDownUpIcon className="size-3.5" />
        ) : (
          <ChevronsUpDownIcon className="size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function OutlineHeadingList(props: {
  readonly mode: "popover" | "sidebar";
  readonly headings: readonly MessageOutlineHeading[];
  readonly topLevel: number;
  readonly activeHeadingIndex: number | null;
  readonly onSelectHeading: (index: number) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const showFilter = props.headings.length > MARKDOWN_OUTLINE_FILTER_THRESHOLD;
  const filteredHeadings = showFilter
    ? filterOutlineHeadings(props.headings, query)
    : props.headings;

  const resolvedCursorIndex =
    cursorIndex !== null && filteredHeadings.some((heading) => heading.index === cursorIndex)
      ? cursorIndex
      : props.activeHeadingIndex !== null &&
          filteredHeadings.some((heading) => heading.index === props.activeHeadingIndex)
        ? props.activeHeadingIndex
        : (filteredHeadings[0]?.index ?? null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the filter input once when opening a long popover outline
  useEffect(() => {
    if (props.mode === "popover" && showFilter) {
      filterInputRef.current?.focus({ preventScroll: true });
    }
  }, [props.mode, showFilter]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- centers the active heading when the popover opens and scrolls the list on sidebar tracking
  useEffect(() => {
    const list = listRef.current;
    if (!list || props.activeHeadingIndex === null) return;
    const target = list.querySelector<HTMLElement>(
      `[data-outline-heading-index="${props.activeHeadingIndex}"]`,
    );
    target?.scrollIntoView({
      block: props.mode === "popover" ? "center" : "nearest",
    });
  }, [props.activeHeadingIndex, props.mode]);

  const moveCursor = (delta: 1 | -1) => {
    if (filteredHeadings.length === 0) return;
    const currentPos = filteredHeadings.findIndex(
      (heading) => heading.index === resolvedCursorIndex,
    );
    const nextPos =
      currentPos < 0
        ? delta > 0
          ? 0
          : filteredHeadings.length - 1
        : (currentPos + delta + filteredHeadings.length) % filteredHeadings.length;
    const nextHeading = filteredHeadings[nextPos];
    if (!nextHeading) return;
    setCursorIndex(nextHeading.index);
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-outline-heading-index="${nextHeading.index}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
    if (document.activeElement !== filterInputRef.current) {
      row?.focus({ preventScroll: true });
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(-1);
      return;
    }
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      if (resolvedCursorIndex === null) return;
      event.preventDefault();
      props.onSelectHeading(resolvedCursorIndex);
      return;
    }
    if (event.key === "Escape" && query.trim().length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" onKeyDown={handleKeyDown}>
      {showFilter ? (
        <div className="shrink-0 border-b border-border/50 px-2 py-1.5">
          <InputGroup variant="ghost" className="h-7">
            <InputGroupAddon align="inline-start">
              <SearchIcon className="size-3.5 text-muted-foreground/70" />
            </InputGroupAddon>
            <InputGroupInput
              ref={filterInputRef}
              type="search"
              size="compact"
              value={query}
              aria-label={gt("Filter headings")}
              placeholder={gt("Filter headings…")}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        </div>
      ) : null}
      <div
        ref={listRef}
        role="navigation"
        aria-label={gt("Document outline")}
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {filteredHeadings.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {gt("No matching headings")}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filteredHeadings.map((heading) => {
              const rawDepth = Math.max(0, heading.level - props.topLevel);
              const visualDepth = resolveVisualOutlineDepth(heading.level, props.topLevel);
              const isActive = heading.index === props.activeHeadingIndex;
              const isHighlighted =
                props.mode === "popover" && resolvedCursorIndex === heading.index && !isActive;
              return (
                <li key={heading.index}>
                  <button
                    type="button"
                    data-outline-heading-index={heading.index}
                    data-outline-active={isActive ? "true" : undefined}
                    aria-current={isActive ? "location" : undefined}
                    onClick={() => props.onSelectHeading(heading.index)}
                    style={{ paddingLeft: 10 + visualDepth * 12 }}
                    className={cn(
                      "relative flex w-full cursor-pointer items-center rounded-md py-1 pr-2 text-left text-xs leading-5 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      rawDepth === 0
                        ? "font-medium text-foreground/90"
                        : rawDepth === 1
                          ? "text-foreground/80"
                          : rawDepth >= 3
                            ? "text-2xs text-muted-foreground/80"
                            : "text-muted-foreground",
                      isHighlighted && "bg-muted/60 text-foreground",
                      isActive &&
                        "bg-accent/70 font-medium text-foreground before:absolute before:inset-y-1.5 before:left-1 before:w-0.5 before:rounded-full before:bg-primary",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{heading.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Subheader toggle button for the Markdown outline (floating Popover or docked sidebar toggle). */
export function MarkdownOutlineTrigger({
  outline,
}: {
  readonly outline: MarkdownOutlineController;
}) {
  const gt = useGT();
  const { layout, popoverOpen, setPopoverOpen, toggleOutline, pinOutline, shortcutLabel } = outline;

  if (!layout.hasHeadings) {
    return (
      <FileSurfaceAction label={gt("No headings in this file")} disabled onPress={() => undefined}>
        <ListTreeIcon className="size-3.5" />
      </FileSurfaceAction>
    );
  }

  const dockedMode = layout.usesDockedToggle || layout.dockedOpen;
  const open = dockedMode ? layout.dockedOpen : popoverOpen;
  const label = open ? gt("Hide outline") : gt("Show outline");
  const tooltipContent = (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <Kbd>{shortcutLabel}</Kbd>
    </span>
  );

  if (dockedMode) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="shrink-0"
              pressed={layout.dockedOpen}
              onPressedChange={toggleOutline}
              aria-label={label}
              variant="ghost"
              size="sm"
            >
              <ListTreeIcon className="size-3.5" />
            </Toggle>
          }
        />
        <TooltipPopup>{tooltipContent}</TooltipPopup>
      </Tooltip>
    );
  }

  const { topLevel, visibleHeadings, hasDeeperHeadings, hiddenCount } =
    selectVisibleOutlineHeadings(outline.headings, outline.showAllLevels);
  const visibleActiveIndex = resolveVisibleActiveHeadingIndex(
    visibleHeadings,
    outline.activeHeadingIndex,
  );
  const countLabel =
    hiddenCount > 0
      ? `${visibleHeadings.length}/${outline.headings.length}`
      : outline.headings.length;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Tooltip>
        <TooltipTrigger render={<span className="flex shrink-0" />}>
          <PopoverTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={popoverOpen}
                onPressedChange={undefined}
                aria-label={label}
                variant="ghost"
                size="sm"
              >
                <ListTreeIcon className="size-3.5" />
              </Toggle>
            }
          />
        </TooltipTrigger>
        <TooltipPopup>{tooltipContent}</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        align="end"
        side="bottom"
        sideOffset={6}
        padding="none"
        className="w-64 overflow-hidden"
      >
        <div className="flex max-h-[min(65vh,420px)] flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs font-medium text-foreground">{gt("Outline")}</span>
              <span className="shrink-0 rounded bg-muted/70 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-muted-foreground">
                {countLabel}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {hasDeeperHeadings ? (
                <OutlineDepthToggleButton
                  showAllLevels={outline.showAllLevels}
                  onToggle={outline.toggleShowAllLevels}
                />
              ) : null}
              {layout.canPinInPopover ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={gt("Pin outline")}
                        onClick={pinOutline}
                      />
                    }
                  >
                    <PinIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="left">{gt("Pin outline")}</TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
          </div>
          <OutlineHeadingList
            key={outline.documentKey}
            mode="popover"
            headings={visibleHeadings}
            topLevel={topLevel}
            activeHeadingIndex={visibleActiveIndex}
            onSelectHeading={(index) => {
              outline.jumpToHeading(index);
              setPopoverOpen(false);
            }}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Typora-style left-docked persistent outline sidebar shown when maximized or pinned wide. */
export function MarkdownOutlineSidebar({
  outline,
}: {
  readonly outline: MarkdownOutlineController;
}) {
  const gt = useGT();
  const [maxWidth, setMaxWidth] = useState(SIDEBAR_MAX_WIDTH);
  const { width, setWidth, handlers } = useResizableWidth({
    storageKey: SIDEBAR_STORAGE_KEY,
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth,
    edge: "right",
  });

  if (!outline.layout.dockedOpen) return null;

  const { layout, unpinOutline, hideDockedOutline } = outline;
  const collapseLabel = layout.canUnpinInSidebar ? gt("Unpin outline") : gt("Hide outline");
  const onCollapse = layout.canUnpinInSidebar ? unpinOutline : hideDockedOutline;
  const { topLevel, visibleHeadings, hasDeeperHeadings, hiddenCount } =
    selectVisibleOutlineHeadings(outline.headings, outline.showAllLevels);
  const visibleActiveIndex = resolveVisibleActiveHeadingIndex(
    visibleHeadings,
    outline.activeHeadingIndex,
  );
  const countLabel =
    hiddenCount > 0
      ? `${visibleHeadings.length}/${outline.headings.length}`
      : outline.headings.length;

  return (
    <aside
      ref={(host) => {
        const row = host?.parentElement;
        if (!row) return;
        const measure = () => {
          const available = Math.max(
            SIDEBAR_MIN_WIDTH,
            Math.min(SIDEBAR_MAX_WIDTH, row.clientWidth - MARKDOWN_BODY_MIN_WIDTH),
          );
          setMaxWidth((previous) => (previous === available ? previous : available));
        };
        measure();
        return observeResize(row, measure);
      }}
      aria-label={gt("Document outline")}
      data-markdown-outline-sidebar
      className="relative flex min-h-0 min-w-0 shrink-0 flex-col border-r border-border/60 bg-background"
      style={
        {
          [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
          width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
        } as CSSProperties
      }
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">{gt("Outline")}</span>
          <span className="shrink-0 rounded bg-muted/70 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-muted-foreground">
            {countLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {hasDeeperHeadings ? (
            <OutlineDepthToggleButton
              showAllLevels={outline.showAllLevels}
              onToggle={outline.toggleShowAllLevels}
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={collapseLabel}
                  onClick={onCollapse}
                />
              }
            >
              {layout.canUnpinInSidebar ? (
                <PinOffIcon className="size-3.5" />
              ) : (
                <PanelLeftCloseIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup>{collapseLabel}</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      <OutlineHeadingList
        key={outline.documentKey}
        mode="sidebar"
        headings={visibleHeadings}
        topLevel={topLevel}
        activeHeadingIndex={visibleActiveIndex}
        onSelectHeading={outline.jumpToHeading}
      />
      <RightPanelResizeHandle
        side="right"
        handlers={handlers}
        label={gt("Resize outline")}
        tabIndex={0}
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={maxWidth}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          let nextWidth: number;
          switch (event.key) {
            case "ArrowRight":
              nextWidth = width + 16;
              break;
            case "ArrowLeft":
              nextWidth = width - 16;
              break;
            case "Home":
              nextWidth = SIDEBAR_MIN_WIDTH;
              break;
            case "End":
              nextWidth = maxWidth;
              break;
            default:
              return;
          }
          event.preventDefault();
          event.stopPropagation();
          setWidth(nextWidth);
        }}
      />
    </aside>
  );
}
