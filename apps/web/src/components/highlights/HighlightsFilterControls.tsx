import { useGT, useMessages } from "gt-react";
import { SearchIcon, XIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { HIGHLIGHT_COLORS, type HighlightColor } from "~/lib/highlightColors";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  HIGHLIGHTS_QUERY_LIMIT,
  type HighlightsSearch,
  type WorkbenchHighlight,
} from "./highlightsWorkbench.logic";

export function HighlightSwatch({ color }: { color: HighlightColor }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full bg-(--swatch-color)"
      style={{ "--swatch-color": `var(--highlight-${color})` } as CSSProperties}
    />
  );
}

function FilterOptions<T extends string>({
  label,
  value,
  onChange,
  options,
  rail,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; count?: number; disabled?: boolean }[];
  rail?: boolean;
}) {
  return (
    <div className={cn("min-w-0", rail && "flex flex-col gap-1")}>
      {rail && <span className="px-2 text-xs font-medium text-muted-foreground">{label}</span>}
      <ToggleGroup
        aria-label={label}
        value={[value]}
        variant={rail ? "default" : "segmented"}
        orientation={rail ? "vertical" : "horizontal"}
        className={rail ? "w-full flex-col" : "max-w-full flex-wrap"}
        onValueChange={(values) => {
          const next = options.find((option) => option.value === values[0]);
          if (next) onChange(next.value);
        }}
      >
        {options.map((option) => (
          <Toggle key={option.value} value={option.value} disabled={option.disabled}>
            {rail ? (
              <span className="flex w-full items-center justify-between gap-2 text-start">
                {option.label}
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {option.count}
                </span>
              </span>
            ) : (
              option.label
            )}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function HighlightsFilterControls({
  mode,
  filters,
  change,
  items,
  scopeOptions,
}: {
  mode: "compact" | "rail";
  filters: HighlightsSearch;
  change: (filters: HighlightsSearch) => void;
  items: readonly WorkbenchHighlight[];
  scopeOptions?: { thread: boolean; project: boolean };
}) {
  const gt = useGT();
  const m = useMessages();
  const rail = mode === "rail";
  const colors = new Set(filters.colors);
  let noted = 0;
  let messages = 0;
  const colorCounts = new Map<HighlightColor, number>();
  for (const { highlight } of items) {
    if (highlight.notes?.length) noted++;
    if (highlight.source.kind === "assistant-message") messages++;
    colorCounts.set(highlight.color, (colorCounts.get(highlight.color) ?? 0) + 1);
  }
  return (
    <div className={cn("flex flex-col gap-2", rail && "gap-4 rounded-xl border bg-card p-3")}>
      <div className="flex items-center gap-2">
        <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Input
          type="search"
          size="compact"
          data-highlight-search=""
          aria-label={gt("Search highlights and notes")}
          placeholder={gt("Search highlights and notes")}
          value={filters.q ?? ""}
          maxLength={HIGHLIGHTS_QUERY_LIMIT}
          onChange={(event) => change({ ...filters, q: event.currentTarget.value })}
        />
        {filters.q && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Clear search")}
            onClick={() => change({ ...filters, q: "" })}
          >
            <XIcon />
          </Button>
        )}
      </div>
      {scopeOptions && (
        <FilterOptions
          rail={rail}
          label={gt("Scope")}
          value={filters.scope ?? "all"}
          onChange={(scope) => change({ ...filters, scope })}
          options={[
            { value: "thread", label: gt("Current thread"), disabled: !scopeOptions.thread },
            { value: "project", label: gt("Current project"), disabled: !scopeOptions.project },
            { value: "all", label: gt("All highlights") },
          ]}
        />
      )}
      <div className={cn("flex flex-wrap gap-2", rail && "flex-col gap-4")}>
        <FilterOptions
          rail={rail}
          label={gt("Group by")}
          value={filters.group ?? "source"}
          onChange={(group) => change({ ...filters, group })}
          options={[
            { value: "source", label: gt("By source") },
            { value: "color", label: gt("By color") },
          ]}
        />
        <FilterOptions
          rail={rail}
          label={gt("Note status")}
          value={filters.view ?? "all"}
          onChange={(view) => change({ ...filters, view })}
          options={[
            { value: "all", label: gt("All"), count: items.length },
            { value: "noted", label: gt("With notes"), count: noted },
            { value: "unnoted", label: gt("Needs note"), count: items.length - noted },
          ]}
        />
        <FilterOptions
          rail={rail}
          label={gt("Source")}
          value={filters.source ?? "all"}
          onChange={(source) => change({ ...filters, source })}
          options={[
            { value: "all", label: gt("All sources"), count: items.length },
            { value: "messages", label: gt("Messages"), count: messages },
            { value: "files", label: gt("Markdown files"), count: items.length - messages },
          ]}
        />
      </div>
      <div className={cn("flex flex-wrap items-center gap-1", rail && "flex-col items-stretch")}>
        {rail && (
          <span className="px-2 text-xs font-medium text-muted-foreground">{gt("Color")}</span>
        )}
        <div
          role="group"
          aria-label={gt("Filter by color")}
          className={cn("flex flex-wrap gap-1", rail && "flex-col")}
        >
          {HIGHLIGHT_COLORS.map(({ id, label }) => {
            const color = m(label);
            const selected = colors.has(id);
            const count = colorCounts.get(id) ?? 0;
            return (
              <Toggle
                key={id}
                size={rail ? "sm" : "compact"}
                variant="outline"
                pressed={selected}
                aria-label={gt("Filter {color}", { color })}
                title={color}
                disabled={!selected && count === 0}
                onPressedChange={(pressed) => {
                  const next = new Set(colors);
                  if (pressed) next.add(id);
                  else next.delete(id);
                  change({ ...filters, colors: [...next] });
                }}
              >
                {rail ? (
                  <span className="flex w-full items-center gap-2 text-start">
                    <HighlightSwatch color={id} />
                    {color}
                    <span className="ms-auto font-mono text-xs tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </span>
                ) : (
                  <HighlightSwatch color={id} />
                )}
              </Toggle>
            );
          })}
        </div>
        {colors.size > 0 && (
          <Button size="xs" variant="ghost" onClick={() => change({ ...filters, colors: [] })}>
            {gt("Clear colors")}
          </Button>
        )}
      </div>
    </div>
  );
}
