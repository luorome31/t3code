import { useGT, useMessages } from "gt-react";
import { HIGHLIGHT_COLORS, type HighlightColor } from "~/lib/highlightColors";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const swatchSizeClassName = {
  sm: "size-4.5",
  md: "size-6",
} as const;

export function HighlightColorPicker({
  value,
  onChange,
  size = "md",
  ariaLabel,
  swatchAriaLabel,
  wrap = false,
}: {
  /** The currently chosen color; omit when the swatches act without a chosen state. */
  readonly value?: HighlightColor;
  readonly onChange: (color: HighlightColor) => void;
  readonly size?: keyof typeof swatchSizeClassName;
  readonly ariaLabel?: string;
  /** Swatch-level accessible name and tooltip; defaults to the color's own label. */
  readonly swatchAriaLabel?: (color: string) => string;
  readonly wrap?: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  return (
    <div
      className={cn("flex items-center gap-1.5", wrap && "flex-wrap")}
      role="group"
      aria-label={ariaLabel ?? gt("Highlight color")}
    >
      {HIGHLIGHT_COLORS.map((color) => {
        const label = m(color.label);
        const swatchLabel = swatchAriaLabel?.(label) ?? label;
        const chosen = value !== undefined && value === color.id;
        return (
          <Tooltip key={color.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={swatchLabel}
                  {...(value !== undefined ? { "aria-pressed": chosen } : {})}
                  onClick={() => onChange(color.id)}
                  className={cn(
                    "cursor-pointer rounded-full border-2 outline-none transition-[box-shadow,scale] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    swatchSizeClassName[size],
                    wrap && "shrink-0",
                    chosen ? "border-foreground/70" : "border-border hover:scale-105",
                  )}
                  style={{ backgroundColor: `var(${color.cssVariable})` }}
                />
              }
            />
            <TooltipPopup>{swatchLabel}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
