import type { ScopedThreadRef } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, ListOrderedIcon } from "lucide-react";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";
import { useQuestionOutline } from "./useQuestionOutline";
import { requestQuestionNavigation } from "./questionOutlineStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";

export function ThreadQuestionsRow({
  threadRef,
  separated,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly separated: boolean;
}) {
  const outline = useQuestionOutline(threadRef);
  if (!outline.enabled) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-questions-heading"
      title="Question outline"
      showHeading={false}
      separated={separated}
    >
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <ThreadDetailsControl
            size="sm"
            variant="ghost"
            part="row"
            onClick={() => useRightPanelStore.getState().open(threadRef, "questions")}
          >
            <ListOrderedIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className={cn("flex-1 text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
              Question outline
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {outline.isPending ? "…" : outline.total}
            </span>
          </ThreadDetailsControl>
        </div>
        {(
          [
            [-1, outline.previous, ArrowUpIcon, "Previous question"],
            [1, outline.next, ArrowDownIcon, "Next question"],
          ] as const
        ).map(([direction, question, Icon, label]) => (
          <Tooltip key={direction}>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  size="icon"
                  variant="ghost"
                  part="icon"
                  aria-label={label}
                  disabled={!question || outline.isPending || outline.request !== null}
                  onClick={() => question && requestQuestionNavigation(outline.threadKey, question)}
                />
              }
            >
              <Icon aria-hidden className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        ))}
      </div>
    </ThreadDetailsSection>
  );
}
