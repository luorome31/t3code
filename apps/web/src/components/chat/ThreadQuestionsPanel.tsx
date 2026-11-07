import { LegendList, type LegendListRef } from "@legendapp/list/react";
import type { OrchestrationV2Question, ScopedThreadRef } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { ListOrderedIcon, PaperclipIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useClientSettings } from "../../hooks/useSettings";
import { formatShortTimestamp } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useQuestionOutline } from "./useQuestionOutline";
import { questionPreview } from "./questionOutline.logic";
import { requestQuestionNavigation } from "./questionOutlineStore";

const keyExtractor = (question: OrchestrationV2Question) => question.messageId;

export function ThreadQuestionsPanel({
  threadRef,
  visible,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
}) {
  const outline = useQuestionOutline(threadRef);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const listRef = useRef<LegendListRef | null>(null);
  const revealedRef = useRef<string | null>(null);
  const currentIndex = outline.questions.findIndex(
    (question) =>
      question.messageId === (outline.request?.question.messageId ?? outline.currentMessageId),
  );
  const revealKey = `${outline.threadKey}:${outline.revealId}`;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reveals the current item in the external list on panel opening or explicit question navigation, without following manual chat scrolling
  useEffect(() => {
    if (!visible) {
      revealedRef.current = null;
      return;
    }
    if (currentIndex < 0 || revealedRef.current === revealKey) return;
    const list = listRef.current;
    if (!list || outline.isPending) return;
    revealedRef.current = revealKey;
    void list.scrollToIndex({ index: currentIndex, animated: false, viewPosition: 0.35 });
  }, [currentIndex, outline.isPending, revealKey, visible]);

  if (!outline.enabled) return null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-question-outline-panel>
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Question outline</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Follow your questions through this conversation.
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-muted/60 px-2 py-1 font-mono text-xs tabular-nums text-muted-foreground">
          {outline.isPending ? "…" : outline.total}
        </span>
      </div>
      {outline.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3"
        >
          <p className="text-xs text-muted-foreground">{outline.error}</p>
          <Button size="xs" variant="outline" onClick={outline.refresh}>
            Retry
          </Button>
        </div>
      ) : null}
      {outline.questions.length === 0 ? (
        <div
          role="status"
          className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center"
        >
          <ListOrderedIcon aria-hidden className="size-7 text-muted-foreground/60" />
          <p className="text-sm font-medium">
            {outline.isPending ? "Loading questions…" : "No questions yet"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {outline.isPending
              ? "Earlier questions are included, too."
              : "Your questions will appear here when the conversation starts."}
          </p>
        </div>
      ) : (
        <LegendList
          recycleItems={false}
          ref={listRef}
          data={outline.questions}
          keyExtractor={keyExtractor}
          estimatedItemSize={112}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2"
          initialScrollIndex={Math.max(0, currentIndex)}
          extraData={{
            currentMessageId: outline.currentMessageId,
            request: outline.request,
            timestampFormat,
          }}
          renderItem={({ item: question, index }) => {
            const iso = DateTime.formatIso(question.createdAt);
            const date = new Date(iso).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const previous = outline.questions[index - 1];
            const previousDate = previous
              ? new Date(DateTime.formatIso(previous.createdAt)).toDateString()
              : null;
            const startsDay = previousDate !== new Date(iso).toDateString();
            const active = question.messageId === outline.currentMessageId;
            const pending = question.messageId === outline.request?.question.messageId;
            const preview = questionPreview(question);
            return (
              <div className="pb-1">
                {startsDay ? (
                  <div className="px-3 pt-3 pb-2 text-2xs font-medium tracking-wide text-muted-foreground">
                    {date}
                  </div>
                ) : null}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Question ${index + 1}: ${preview}`}
                        aria-current={active ? "location" : undefined}
                        aria-busy={pending || undefined}
                        className={cn(
                          "relative flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          active && "bg-primary/7 hover:bg-primary/10",
                        )}
                        onClick={() => requestQuestionNavigation(outline.threadKey, question)}
                      />
                    }
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary/70"
                      />
                    ) : null}
                    <span
                      aria-hidden
                      className={cn(
                        "min-w-5 pt-0.5 font-mono text-2xs tabular-nums text-muted-foreground/65",
                        active && "text-foreground",
                      )}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "line-clamp-3 whitespace-pre-line break-words text-sm leading-5 text-foreground/80",
                          active && "font-medium text-foreground",
                        )}
                      >
                        {preview}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2 text-2xs text-muted-foreground">
                        <time dateTime={iso}>{formatShortTimestamp(iso, timestampFormat)}</time>
                        {question.attachments.length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <PaperclipIcon aria-hidden className="size-3" />
                            {question.attachments.length}
                          </span>
                        ) : null}
                        {pending ? <span role="status">Jumping…</span> : null}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup side="left">
                    <div className="max-h-72 max-w-80 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
                      {preview}
                    </div>
                  </TooltipPopup>
                </Tooltip>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
