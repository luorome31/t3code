import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  SMALLTALK_SOURCE_TEXT_MAX_LENGTH,
  type ScopedThreadRef,
  type Smalltalk,
  type SmalltalkMutation,
  type SmalltalkSummary,
  type MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import {
  AlertCircle,
  Ban,
  Check,
  CornerUpLeft,
  LoaderCircle,
  MessageCircleMoreIcon,
  RotateCw,
  MessageSquareQuote,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { smalltalkEnvironment, selectedSmalltalkAtom } from "../../state/smalltalk";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRightPanelStore } from "../../rightPanelStore";
import { assistantCitationNavigation } from "../../lib/assistantCitationNavigation";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MessageCopyButton } from "./MessageCopyButton";
import { ThreadHighlightsRow } from "./ThreadHighlightsRow";
import { cn } from "~/lib/utils";

export function SmalltalkButton(props: {
  threadRef: ScopedThreadRef;
  sourceThreadId: ThreadId;
  messageId: MessageId;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(props.threadRef.environmentId));
  const allowed = useAtomValue(
    smalltalkEnvironment.mutate.permissionAtom(props.threadRef.environmentId),
  );
  const mutate = useAtomCommand(smalltalkEnvironment.mutate);
  const select = useAtomSet(selectedSmalltalkAtom(scopedThreadKey(props.threadRef)));
  const [busy, setBusy] = useState(false);
  if (config?.environment.capabilities.smalltalk !== true || !allowed) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label="说人话"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void mutate({
                environmentId: props.threadRef.environmentId,
                input: {
                  action: "create",
                  threadId: props.threadRef.threadId,
                  sourceThreadId: props.sourceThreadId,
                  messageId: props.messageId,
                },
              })
                .then((result) => {
                  if (result._tag === "Success" && result.value) {
                    select(result.value.id);
                    useRightPanelStore.getState().open(props.threadRef, "smalltalk");
                  }
                })
                .finally(() => setBusy(false));
            }}
          />
        }
      >
        <MessageCircleMoreIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup>说人话</TooltipPopup>
    </Tooltip>
  );
}

export function MarkdownSmalltalkButton(props: {
  threadRef: ScopedThreadRef;
  relativePath: string;
  text: string;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(props.threadRef.environmentId));
  const allowed = useAtomValue(
    smalltalkEnvironment.mutate.permissionAtom(props.threadRef.environmentId),
  );
  const mutate = useAtomCommand(smalltalkEnvironment.mutate);
  const select = useAtomSet(selectedSmalltalkAtom(scopedThreadKey(props.threadRef)));
  const [busy, setBusy] = useState(false);
  if (config?.environment.capabilities.smalltalk !== true || !allowed) return null;
  if (config.environment.capabilities.smalltalkFileSource !== true) return null;
  const blank = props.text.trim().length === 0;
  const tooLong = props.text.length > SMALLTALK_SOURCE_TEXT_MAX_LENGTH;
  const disabled = busy || blank || tooLong;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="说人话"
            aria-disabled={disabled}
            onClick={() => {
              if (disabled) return;
              setBusy(true);
              void mutate({
                environmentId: props.threadRef.environmentId,
                input: {
                  action: "create",
                  threadId: props.threadRef.threadId,
                  source: {
                    kind: "markdown-file",
                    relativePath: props.relativePath,
                    text: props.text,
                  },
                },
              })
                .then((result) => {
                  if (result._tag === "Success" && result.value) {
                    select(result.value.id);
                    useRightPanelStore.getState().open(props.threadRef, "smalltalk");
                  }
                })
                .finally(() => setBusy(false));
            }}
          />
        }
      >
        <MessageCircleMoreIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup>
        {blank ? "文件为空，无法说人话" : tooLong ? "文件太长，无法说人话" : "说人话"}
      </TooltipPopup>
    </Tooltip>
  );
}

export function ThreadSmalltalkRow({ threadRef }: { threadRef: ScopedThreadRef }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  if (config?.environment.capabilities.smalltalk !== true) return null;
  return <SmalltalkCountRow threadRef={threadRef} />;
}

function SmalltalkCountRow({ threadRef }: { threadRef: ScopedThreadRef }) {
  const list = useAtomValue(
    smalltalkEnvironment.list({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  return (
    <ThreadHighlightsRow
      title="Smalltalk"
      icon={MessageCircleMoreIcon}
      count={
        AsyncResult.isSuccess(list)
          ? list.value.filter((record) => record.status === "completed").length
          : 0
      }
      separated={false}
      onOpen={() => useRightPanelStore.getState().open(threadRef, "smalltalk")}
    />
  );
}

export function SmalltalkPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const list = useAtomValue(
    smalltalkEnvironment.list({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const requested = useAtomValue(selectedSmalltalkAtom(scopedThreadKey(threadRef)));
  const select = useAtomSet(selectedSmalltalkAtom(scopedThreadKey(threadRef)));
  if (AsyncResult.isFailure(list))
    return (
      <p className="p-4 text-sm">Could not load Smalltalk. Reconnect or update this environment.</p>
    );
  if (!AsyncResult.isSuccess(list)) return <p className="p-4 text-sm">Loading Smalltalk…</p>;

  const records = list.value;
  const generating = records.filter((record) => record.status === "generating");
  const completed = records.filter((record) => record.status === "completed");
  const selected =
    records.find((record) => record.id === requested) ??
    generating[0] ??
    completed[0] ??
    records[0];
  const selectedNotInHistory =
    selected !== undefined && selected.status !== "completed" && selected.status !== "generating"
      ? [selected]
      : [];
  const visible = [...generating, ...selectedNotInHistory, ...completed];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageCircleMoreIcon aria-hidden className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Smalltalk</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {completed.length}
        </span>
        {generating.length > 0 ? (
          <LoaderCircle
            aria-label="Generating"
            className="size-3.5 animate-spin text-muted-foreground"
          />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-xs text-muted-foreground">
            <MessageCircleMoreIcon aria-hidden className="size-5" />
            <span>还没有解释</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visible.map((record) => (
              <SmalltalkRecord
                key={record.id}
                threadRef={threadRef}
                record={record}
                selected={record.id === selected?.id}
                onSelect={() => select(record.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SmalltalkRecord(props: {
  threadRef: ScopedThreadRef;
  record: SmalltalkSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border",
        props.selected ? "border-border bg-card" : "border-transparent",
      )}
    >
      <button
        type="button"
        aria-expanded={props.selected}
        onClick={props.onSelect}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors",
          !props.selected && "hover:bg-accent",
        )}
      >
        <SmalltalkStatusIcon status={props.record.status} />
        <span className="min-w-0 flex-1 truncate text-sm">{props.record.title || "Smalltalk"}</span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {formatRelativeTimeLabel(props.record.createdAt)}
        </span>
      </button>
      {props.selected ? (
        <SmalltalkDetail threadRef={props.threadRef} id={props.record.id} summary={props.record} />
      ) : null}
    </section>
  );
}

function SmalltalkStatusIcon({ status }: { status: SmalltalkSummary["status"] }) {
  switch (status) {
    case "generating":
      return <LoaderCircle aria-hidden className="size-3.5 animate-spin text-muted-foreground" />;
    case "completed":
      return <Check aria-hidden className="size-3.5 text-muted-foreground" />;
    case "failed":
      return <AlertCircle aria-hidden className="size-3.5 text-destructive" />;
    case "cancelled":
      return <Ban aria-hidden className="size-3.5 text-muted-foreground" />;
  }
}

function SmalltalkDetail({
  threadRef,
  id,
  summary,
}: {
  threadRef: ScopedThreadRef;
  id: string;
  summary: SmalltalkSummary;
}) {
  const detail = useAtomValue(
    smalltalkEnvironment.detail({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, id },
    }),
  );
  if (!AsyncResult.isSuccess(detail))
    return (
      <p className="px-2.5 pb-2 text-xs text-muted-foreground">
        {AsyncResult.isFailure(detail) ? "Could not load this explanation." : "Loading…"}
      </p>
    );
  return <SmalltalkContent threadRef={threadRef} record={detail.value} summary={summary} />;
}

function SmalltalkContent({
  threadRef,
  record,
  summary,
}: {
  threadRef: ScopedThreadRef;
  record: Smalltalk;
  summary: SmalltalkSummary;
}) {
  const allowed = useAtomValue(smalltalkEnvironment.mutate.permissionAtom(threadRef.environmentId));
  const mutate = useAtomCommand(smalltalkEnvironment.mutate);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isGenerating = summary.status === "generating";
  const stale = record.status !== summary.status;
  const explanation = isGenerating ? summary.streamingText : stale ? "" : record.explanation;
  const model = record.modelSelection?.model ?? record.requestedModelSelection?.model ?? "未知";

  const apply = (input: SmalltalkMutation) => {
    setBusy(true);
    setConfirmDelete(false);
    void mutate({ environmentId: threadRef.environmentId, input }).finally(() => setBusy(false));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pb-2 text-2xs text-muted-foreground">
        <span className="min-w-0 max-w-48 truncate">{model}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                aria-label={`Preset: ${record.preset.name}`}
                className="inline-flex items-center"
              />
            }
          >
            <MessageSquareQuote aria-hidden className="size-3" />
          </TooltipTrigger>
          <TooltipPopup>{record.preset.name}</TooltipPopup>
        </Tooltip>
        <div className="ml-auto flex items-center gap-0.5">
          {record.filePath === null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Jump to original answer"
                    onClick={() => {
                      void navigate(
                        assistantCitationNavigation(
                          {
                            version: 1,
                            environmentId: threadRef.environmentId,
                            threadId: threadRef.threadId,
                            messageId: record.messageId,
                            text: record.sourceText.slice(0, 200),
                            start: 0,
                            end: Math.min(record.sourceText.length, 200),
                            prefix: "",
                            suffix: "",
                          },
                          null,
                          { silent: true },
                        ),
                      );
                    }}
                  />
                }
              >
                <CornerUpLeft />
              </TooltipTrigger>
              <TooltipPopup>跳转到原回答</TooltipPopup>
            </Tooltip>
          ) : null}
          {explanation ? (
            <MessageCopyButton
              text={explanation}
              label="Copy explanation"
              size="icon-xs"
              variant="ghost"
            />
          ) : null}
          {allowed ? (
            <>
              {isGenerating ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Cancel generation"
                        disabled={busy}
                        onClick={() =>
                          apply({ action: "cancel", threadId: threadRef.threadId, id: record.id })
                        }
                      />
                    }
                  >
                    <X />
                  </TooltipTrigger>
                  <TooltipPopup>取消生成</TooltipPopup>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={record.explanation ? "Regenerate" : "Retry"}
                        disabled={busy}
                        onClick={() =>
                          apply({
                            action: "regenerate",
                            threadId: threadRef.threadId,
                            id: record.id,
                          })
                        }
                      />
                    }
                  >
                    <RotateCw />
                  </TooltipTrigger>
                  <TooltipPopup>{record.explanation ? "重新生成" : "重试"}</TooltipPopup>
                </Tooltip>
              )}
              {confirmDelete ? (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost-destructive"
                          aria-label="Confirm delete"
                          disabled={busy}
                          onClick={() =>
                            apply({
                              action: "delete",
                              threadId: threadRef.threadId,
                              id: record.id,
                            })
                          }
                        />
                      }
                    >
                      <Check />
                    </TooltipTrigger>
                    <TooltipPopup>确认删除</TooltipPopup>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Cancel delete"
                          onClick={() => setConfirmDelete(false)}
                        />
                      }
                    >
                      <X />
                    </TooltipTrigger>
                    <TooltipPopup>取消</TooltipPopup>
                  </Tooltip>
                </>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost-destructive"
                        aria-label="Delete"
                        disabled={busy}
                        onClick={() => setConfirmDelete(true)}
                      />
                    }
                  >
                    <Trash2 />
                  </TooltipTrigger>
                  <TooltipPopup>删除</TooltipPopup>
                </Tooltip>
              )}
            </>
          ) : null}
        </div>
      </div>
      {(isGenerating || stale) && !explanation ? (
        <div
          role="status"
          className="flex items-center gap-2 px-2.5 pb-2 text-xs text-muted-foreground"
        >
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          <span>{isGenerating ? "生成中…" : "载入中…"}</span>
        </div>
      ) : null}
      {!isGenerating && record.error ? (
        <p role="alert" className="px-2.5 pb-2 text-xs text-destructive">
          {record.error}{" "}
          <a href="/settings/threads" className="underline">
            设置
          </a>
        </p>
      ) : null}
      {explanation ? (
        <div className="px-2.5 pb-2">
          <ChatMarkdown cwd={undefined} text={explanation} threadRef={threadRef} />
        </div>
      ) : null}
    </>
  );
}
