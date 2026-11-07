import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type Smalltalk,
  type OrchestrationV2ProjectedTurnItem,
  type SmalltalkMutation,
  SYSTEM_SMALLTALK_PRESET,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useThreadShell } from "../../state/entities";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useState } from "react";
import { View, Pressable } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { requestThreadMessageJump } from "./threadMessageJump";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { smalltalkEnvironment } from "../../state/smalltalk";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

export function MobileSmalltalkButton(props: {
  threadRef: ScopedThreadRef;
  projectedItem: OrchestrationV2ProjectedTurnItem;
}) {
  const navigation = useNavigation();
  const config = useAtomValue(serverEnvironment.configValueAtom(props.threadRef.environmentId));
  const allowed = useAtomValue(
    smalltalkEnvironment.mutate.permissionAtom(props.threadRef.environmentId),
  );
  const mutate = useAtomCommand(smalltalkEnvironment.mutate);
  const [busy, setBusy] = useState(false);
  const item = props.projectedItem.item;
  if (
    !allowed ||
    config?.environment.capabilities.smalltalk !== true ||
    item.type !== "assistant_message" ||
    item.status !== "completed"
  )
    return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="说人话"
      disabled={busy}
      className="size-7 items-center justify-center"
      onPress={() => {
        setBusy(true);
        void mutate({
          environmentId: props.threadRef.environmentId,
          input: {
            action: "create",
            threadId: props.threadRef.threadId,
            sourceThreadId: props.projectedItem.sourceThreadId,
            messageId: item.messageId,
          },
        })
          .then((result) => {
            if (result._tag === "Success" && result.value)
              navigation.navigate("ThreadSmalltalk", {
                ...props.threadRef,
                selectedId: result.value.id,
              });
          })
          .finally(() => setBusy(false));
      }}
    >
      <SymbolView name="text.bubble" size={13} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );
}

export function SmalltalkRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: string; threadId: string; selectedId?: string }>) {
  const navigation = useNavigation();
  const threadRef = {
    environmentId: EnvironmentId.make(route.params.environmentId),
    threadId: ThreadId.make(route.params.threadId),
  };
  const list = useAtomValue(
    smalltalkEnvironment.list({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const [selectedId, setSelectedId] = useState(route.params.selectedId);
  const rows = AsyncResult.isSuccess(list) ? list.value : [];
  const selected = rows.find((record) => record.id === selectedId) ?? rows[0];
  return (
    <View className="flex-1 bg-screen">
      <AppBar title={`Smalltalk · ${rows.length}`} onBack={() => navigation.goBack()} />
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 p-5 pb-16"
      >
        {rows.map((record) => (
          <ListChoiceRow
            key={record.id}
            label={record.title}
            description={record.status}
            selected={record.id === selected?.id}
            onPress={() => setSelectedId(record.id)}
          />
        ))}
        {!selected ? (
          <Text>
            {AsyncResult.isFailure(list)
              ? "Could not load Smalltalk. Reconnect or update the environment."
              : AsyncResult.isSuccess(list)
                ? "Use 说人话 beside a completed response to create an explanation."
                : "Loading Smalltalk…"}
          </Text>
        ) : (
          <MobileSmalltalkDetail key={selected.id} threadRef={threadRef} id={selected.id} />
        )}
      </ScreenScrollView>
    </View>
  );
}
function MobileSmalltalkDetail({ threadRef, id }: { threadRef: ScopedThreadRef; id: string }) {
  const detail = useAtomValue(
    smalltalkEnvironment.detail({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, id },
    }),
  );
  if (!AsyncResult.isSuccess(detail))
    return (
      <Text>
        {AsyncResult.isFailure(detail)
          ? "Could not load this explanation."
          : "Loading explanation…"}
      </Text>
    );
  return <MobileSmalltalkContent threadRef={threadRef} record={detail.value} />;
}
function MobileSmalltalkContent({
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
  const navigation = useNavigation();
  const styles = useMarkdownPreviewStyles();
  const [presetOverride, setPresetId] = useState<string | null>(null);
  const presetId =
    presetOverride ?? settings?.smalltalkDefaultPresetId ?? SYSTEM_SMALLTALK_PRESET.id;
  const [showSource, setShowSource] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const presets = [SYSTEM_SMALLTALK_PRESET, ...(settings?.smalltalkPresets ?? [])];
  const apply = (input: SmalltalkMutation) => {
    setBusy(true);
    void mutate({ environmentId: threadRef.environmentId, input }).finally(() => setBusy(false));
  };
  return (
    <View className="gap-4">
      <Text className="text-sm text-foreground-muted">
        {record.status} · {record.modelSelection?.model ?? "No completed generation"} ·{" "}
        {record.preset.name}
      </Text>
      {record.status === "generating" ? <Text>Generating explanation…</Text> : null}
      {record.error ? <Text accessibilityRole="alert">{record.error}</Text> : null}
      {record.explanation ? (
        <>
          <SelectableMarkdownText
            markdown={record.explanation}
            textStyle={styles.nativeTextStyle}
          />
          <Button
            label="Copy explanation"
            onPress={() => {
              void copyTextWithHaptic(record.explanation);
            }}
          />
        </>
      ) : null}
      <Button
        label="View original response"
        onPress={() => {
          requestThreadMessageJump(scopedThreadKey(threadRef), record.messageId);
          navigation.dispatch(
            StackActions.popTo(
              "Thread",
              { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
              { merge: true },
            ),
          );
        }}
      />
      <Button
        label={showSource ? "Hide original snapshot" : "Original response snapshot"}
        onPress={() => setShowSource(!showSource)}
      />
      {showSource ? (
        <SelectableMarkdownText markdown={record.sourceText} textStyle={styles.nativeTextStyle} />
      ) : null}
      {allowed ? (
        <>
          {presets.map((preset) => (
            <ListChoiceRow
              key={preset.id}
              label={preset.name}
              selected={preset.id === presetId}
              onPress={() => setPresetId(preset.id)}
            />
          ))}
          <Button
            label={record.explanation ? "Regenerate" : "Retry"}
            disabled={busy || record.status === "generating"}
            onPress={() =>
              apply({ action: "regenerate", threadId: threadRef.threadId, id: record.id, presetId })
            }
          />
          {record.status === "generating" ? (
            <Button
              label="Cancel"
              disabled={busy}
              onPress={() =>
                apply({ action: "cancel", threadId: threadRef.threadId, id: record.id })
              }
            />
          ) : null}
          <Button
            tone="danger"
            label={confirmDelete ? "Confirm delete" : "Delete"}
            disabled={busy}
            onPress={() => {
              if (confirmDelete)
                apply({ action: "delete", threadId: threadRef.threadId, id: record.id });
              else setConfirmDelete(true);
            }}
          />
        </>
      ) : null}
    </View>
  );
}
