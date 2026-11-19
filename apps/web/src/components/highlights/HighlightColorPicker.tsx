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
  ariaLabel = "Highlight color",
}: {
  readonly value: HighlightColor;
  readonly onChange: (color: HighlightColor) => void;
  readonly size?: keyof typeof swatchSizeClassName;
  readonly ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={ariaLabel}>
      {HIGHLIGHT_COLORS.map((color) => (
        <Tooltip key={color.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={color.label}
                aria-pressed={value === color.id}
                onClick={() => onChange(color.id)}
                className={cn(
                  "cursor-pointer rounded-full border-2 outline-none transition-[box-shadow,scale] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  swatchSizeClassName[size],
                  value === color.id ? "border-foreground/70" : "border-border hover:scale-105",
                )}
                style={{ backgroundColor: `var(${color.cssVariable})` }}
              />
            }
          />
          <TooltipPopup>{color.label}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
