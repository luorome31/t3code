import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  type ScopedThreadRef,
  type Smalltalk,
  type SmalltalkMutation,
  type MessageId,
  type ThreadId,
  SYSTEM_SMALLTALK_PRESET,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { MessageCircleMoreIcon } from "lucide-react";
import { useThreadShell } from "../../state/entities";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { smalltalkEnvironment, selectedSmalltalkAtom } from "../../state/smalltalk";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRightPanelStore } from "../../rightPanelStore";
import { assistantCitationNavigation } from "../../lib/assistantCitationNavigation";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { MessageCopyButton } from "./MessageCopyButton";
import { ThreadHighlightsRow } from "./ThreadHighlightsRow";

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
      count={AsyncResult.isSuccess(list) ? list.value.length : 0}
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
  const selected = list.value.find((record) => record.id === requested) ?? list.value[0];
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-4 gap-4">
      <h2 className="text-sm font-medium">Smalltalk · {list.value.length}</h2>
      {selected ? (
        <>
          <Select
            value={selected.id}
            onValueChange={(value) => {
              if (value) select(value);
            }}
          >
            <SelectTrigger aria-label="Select Smalltalk">
              <SelectValue>{selected.title}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {list.value.map((record) => (
                <SelectItem key={record.id} value={record.id}>
                  {record.title} · {record.status}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <SmalltalkDetail key={selected.id} threadRef={threadRef} id={selected.id} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No Smalltalk yet. Use 说人话 beside a completed response to create an explanation.
        </p>
      )}
    </div>
  );
}
function SmalltalkDetail({ threadRef, id }: { threadRef: ScopedThreadRef; id: string }) {
  const detail = useAtomValue(
    smalltalkEnvironment.detail({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, id },
    }),
  );
  if (!AsyncResult.isSuccess(detail))
    return (
      <p className="text-sm">
        {AsyncResult.isFailure(detail)
          ? "Could not load this explanation."
          : "Loading explanation…"}
      </p>
    );
  return <SmalltalkContent threadRef={threadRef} record={detail.value} />;
}
function SmalltalkContent({
  threadRef,
  record,
}: {
  threadRef: ScopedThreadRef;
  record: Smalltalk;
}) {
  const environmentSettings = useAtomValue(
    serverEnvironment.settingsValueAtom(threadRef.environmentId),
  );
  const thread = useThreadShell(threadRef);
  const settings = environmentSettings
    ? resolveProjectSettings(environmentSettings, thread?.projectId ?? null).settings
    : null;
  const allowed = useAtomValue(smalltalkEnvironment.mutate.permissionAtom(threadRef.environmentId));
  const mutate = useAtomCommand(smalltalkEnvironment.mutate);
  const navigate = useNavigate();
  const [presetOverride, setPresetId] = useState<string | null>(null);
  const presetId =
    presetOverride ?? settings?.smalltalkDefaultPresetId ?? SYSTEM_SMALLTALK_PRESET.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const presets = [SYSTEM_SMALLTALK_PRESET, ...(settings?.smalltalkPresets ?? [])];
  const apply = (input: SmalltalkMutation) => {
    setBusy(true);
    void mutate({ environmentId: threadRef.environmentId, input }).finally(() => setBusy(false));
  };
  return (
    <>
      <div className="text-xs text-muted-foreground">
        {record.status} · {new Date(record.createdAt).toLocaleString()}
        <br />
        {record.modelSelection?.model ?? "No completed generation"} · {record.preset.name}
      </div>
      {record.status === "generating" ? (
        <p role="status" className="text-sm">
          Generating explanation…
        </p>
      ) : null}
      {record.error ? (
        <p role="alert" className="text-sm text-destructive">
          {record.error}{" "}
          <a href="/settings/threads" className="underline">
            Settings
          </a>
        </p>
      ) : null}
      {record.explanation ? (
        <>
          <ChatMarkdown cwd={undefined} text={record.explanation} threadRef={threadRef} />
          <div>
            <MessageCopyButton text={record.explanation} />
          </div>
        </>
      ) : null}
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigate(
              assistantCitationNavigation({
                version: 1,
                environmentId: threadRef.environmentId,
                threadId: threadRef.threadId,
                messageId: record.messageId,
                text: record.sourceText.slice(0, 200),
                start: 0,
                end: Math.min(record.sourceText.length, 200),
                prefix: "",
                suffix: "",
              }),
            );
          }}
        >
          View original response
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-sm">Original response snapshot</summary>
        <div className="mt-2">
          <ChatMarkdown cwd={undefined} text={record.sourceText} threadRef={threadRef} />
        </div>
      </details>
      {allowed ? (
        <>
          <Select
            value={
              presets.some((preset) => preset.id === presetId)
                ? presetId
                : SYSTEM_SMALLTALK_PRESET.id
            }
            onValueChange={(value) => {
              if (value) setPresetId(value);
            }}
          >
            <SelectTrigger aria-label="Smalltalk prompt preset">
              <SelectValue>
                {presets.find((preset) => preset.id === presetId)?.name ??
                  SYSTEM_SMALLTALK_PRESET.name}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || record.status === "generating"}
              onClick={() =>
                apply({
                  action: "regenerate",
                  threadId: threadRef.threadId,
                  id: record.id,
                  presetId,
                })
              }
            >
              {record.explanation ? "Regenerate" : "Retry"}
            </Button>
            {record.status === "generating" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  apply({ action: "cancel", threadId: threadRef.threadId, id: record.id })
                }
              >
                Cancel
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (confirmDelete)
                  apply({ action: "delete", threadId: threadRef.threadId, id: record.id });
                else setConfirmDelete(true);
              }}
            >
              {confirmDelete ? "Confirm delete" : "Delete"}
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}
