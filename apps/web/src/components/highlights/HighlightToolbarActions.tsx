import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { ChevronDownIcon, EraserIcon, HighlighterIcon } from "lucide-react";
import { useState } from "react";

import {
  MAX_HIGHLIGHT_TEXT_LENGTH,
  useHighlightColorMode,
  useHighlightStore,
  useThreadDefaultColor,
  type HighlightColor,
} from "~/highlightStore";
import { HIGHLIGHT_COLORS, highlightColorDefinition } from "~/lib/highlightColors";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HighlightColorPicker } from "./HighlightColorPicker";

export function HighlightToolbarActions({
  threadRef,
  supported,
  tooLong,
  hasExistingHighlight,
  onAdd,
  onRemove,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly supported: boolean;
  readonly tooLong: boolean;
  readonly hasExistingHighlight: boolean;
  readonly onAdd: (color: HighlightColor) => void;
  readonly onRemove: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const colorMode = useHighlightColorMode();
  const threadDefaultColor = useThreadDefaultColor(threadRef);
  const setThreadDefaultColor = useHighlightStore((state) => state.setThreadDefaultColor);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const disabled = tooLong || !supported;

  if (disabled || hasExistingHighlight) {
    return (
      <Button
        type="button"
        size="xs"
        variant="glass"
        disabled={disabled}
        aria-label={
          !supported
            ? gt("Highlights are not supported in this browser")
            : tooLong
              ? gt("Selection is too long to highlight (maximum {count} characters)", {
                  count: MAX_HIGHLIGHT_TEXT_LENGTH,
                })
              : hasExistingHighlight
                ? gt("Remove highlight")
                : gt("Highlight selection")
        }
        onClick={hasExistingHighlight ? onRemove : undefined}
      >
        {hasExistingHighlight ? (
          <EraserIcon aria-hidden="true" className="size-3.5" />
        ) : (
          <HighlighterIcon aria-hidden="true" className="size-3.5" />
        )}
        {!supported
          ? gt("Unavailable")
          : hasExistingHighlight
            ? gt("Remove highlight")
            : tooLong
              ? gt("Too long")
              : gt("Highlight")}
      </Button>
    );
  }

  if (colorMode === "thread") {
    const definition = highlightColorDefinition(threadDefaultColor);
    return (
      <div
        className="flex items-center gap-1"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          if (!paletteOpen) return;
          // Escape closes the palette first; the toolbar dismisses on the next press.
          event.stopPropagation();
          event.preventDefault();
          setPaletteOpen(false);
        }}
      >
        <Button
          type="button"
          size="xs"
          variant="glass"
          aria-label={gt("Highlight selection")}
          onClick={() => onAdd(threadDefaultColor)}
        >
          <HighlighterIcon aria-hidden="true" className="size-3.5" />
          {gt("Highlight")}
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="xs"
                variant="glass"
                aria-label={gt("Thread highlight color")}
                aria-expanded={paletteOpen}
                onClick={() => setPaletteOpen(!paletteOpen)}
              />
            }
          >
            <span
              aria-hidden="true"
              className="size-3 rounded-full"
              style={{ backgroundColor: `var(${definition.cssVariable})` }}
            />
            <ChevronDownIcon
              aria-hidden="true"
              className={cn("size-3 transition-transform", paletteOpen && "rotate-180")}
            />
          </TooltipTrigger>
          <TooltipPopup>{gt("Thread highlight color")}</TooltipPopup>
        </Tooltip>
        {paletteOpen ? (
          <div className="border-l border-border/60 pl-1">
            <HighlightColorPicker
              size="sm"
              value={threadDefaultColor}
              ariaLabel={gt("Thread highlight palette")}
              swatchAriaLabel={(color) =>
                gt("Highlight selection as {color} and set the thread default", { color })
              }
              onChange={(color) => {
                setThreadDefaultColor(threadRef, color);
                onAdd(color);
                setPaletteOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={gt("Highlight color")}>
      {HIGHLIGHT_COLORS.map((color) => (
        <Tooltip key={color.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={gt("Highlight selection as {color}", { color: m(color.label) })}
                onClick={() => onAdd(color.id)}
                className="size-4.5 cursor-pointer rounded-full border-2 border-border outline-none transition-[box-shadow,scale] hover:scale-105 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                style={{ backgroundColor: `var(${color.cssVariable})` }}
              />
            }
          />
          <TooltipPopup>{m(color.label)}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
