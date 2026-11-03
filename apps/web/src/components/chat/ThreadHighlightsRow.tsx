import { HighlighterIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadHighlightsRow({
  count,
  separated,
  onOpen,
}: {
  readonly count: number;
  readonly separated: boolean;
  readonly onOpen?: (() => void) | undefined;
}) {
  return (
    <ThreadDetailsSection
      headingId="thread-details-highlights-heading"
      title="Highlights"
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
          <HighlighterIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
          <span className={cn("flex-1 text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
            Highlights
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
        </ThreadDetailsControl>
      </div>
    </ThreadDetailsSection>
  );
}
