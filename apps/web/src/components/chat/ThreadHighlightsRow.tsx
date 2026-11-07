import type { LucideIcon } from "lucide-react";
import { HighlighterIcon } from "lucide-react";

import { cn } from "~/lib/utils";
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
}: {
  readonly title?: string;
  readonly icon?: LucideIcon;
  readonly count: number;
  readonly separated: boolean;
  readonly onOpen?: (() => void) | undefined;
}) {
  return (
    <ThreadDetailsSection
      headingId={`thread-details-${title.toLowerCase()}-heading`}
      title={title}
      showHeading={false}
      separated={separated}
    >
      <div className="flex flex-col">
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
      </div>
    </ThreadDetailsSection>
  );
}
