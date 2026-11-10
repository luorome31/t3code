import type { LucideIcon } from "lucide-react";
import { HighlighterIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadHighlightsRow({
  title = "Highlights",
  icon: Icon = HighlighterIcon,
  count,
  separated,
  onOpen,
  tooltip,
  trailing,
}: {
  readonly title?: string;
  readonly icon?: LucideIcon;
  readonly count: number | string;
  readonly separated: boolean;
  readonly onOpen?: (() => void) | undefined;
  readonly tooltip?: ReactNode;
  readonly trailing?: ReactNode;
}) {
  const control = (
    <ThreadDetailsControl
      type="button"
      size="sm"
      variant="ghost"
      part="row"
      disabled={!onOpen}
      onClick={onOpen}
    >
      <Icon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
      <span className={cn("flex-1 text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}>{title}</span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
    </ThreadDetailsControl>
  );
  return (
    <ThreadDetailsSection
      headingId={`thread-details-${title.toLowerCase().replace(/\s+/g, "-")}-heading`}
      title={title}
      showHeading={false}
      separated={separated}
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          {tooltip === undefined ? (
            control
          ) : (
            <Tooltip>
              <TooltipTrigger render={control} />
              <TooltipPopup side="left">{tooltip}</TooltipPopup>
            </Tooltip>
          )}
        </div>
        {trailing}
      </div>
    </ThreadDetailsSection>
  );
}
