import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type Smalltalk,
  type SmalltalkMutation,
  type SmalltalkSummary,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Alert, View, Pressable } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { AppBar } from "../../components/ui/AppBar";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
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
  const records = AsyncResult.isSuccess(list) ? list.value : [];
  const generating = records.filter((record) => record.status === "generating");
  const completed = records.filter((record) => record.status === "completed");
  const selected =
    records.find((record) => record.id === selectedId) ??
    generating[0] ??
    completed[0] ??
    records[0];
  const selectedNotInHistory =
    selected !== undefined && selected.status !== "completed" && selected.status !== "generating"
      ? [selected]
      : [];
  const visibleRows = [...generating, ...selectedNotInHistory, ...completed];
  return (
    <View className="flex-1 bg-screen">
      <AppBar title={`Smalltalk · ${completed.length}`} onBack={() => navigation.goBack()} />
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 p-5 pb-16"
      >
        {visibleRows.map((record) => (
          <ListChoiceRow
            key={record.id}
            label={record.title || "Smalltalk"}
            leading={<SmalltalkRowIcon status={record.status} />}
            selected={record.id === selected?.id}
            onPress={() => setSelectedId(record.id)}
          />
        ))}
        {!selected ? (
          <Text>
            {AsyncResult.isFailure(list)
              ? "Could not load Smalltalk. Reconnect or update the environment."
              : AsyncResult.isSuccess(list)
                ? "还没有解释。"
                : "Loading Smalltalk…"}
          </Text>
        ) : (
          <MobileSmalltalkDetail
            key={selected.id}
            threadRef={threadRef}
            id={selected.id}
            summary={selected}
          />
        )}
      </ScreenScrollView>
    </View>
  );
}

function SmalltalkRowIcon({ status }: { status: SmalltalkSummary["status"] }) {
  switch (status) {
    case "generating":
      return <AppActivityIndicator size="small" />;
    case "completed":
      return (
        <SymbolView
          name="checkmark.circle"
          size={16}
          tintColorClassName="accent-foreground-muted"
        />
      );
    case "failed":
      return (
        <SymbolView
          name="exclamationmark.circle"
          size={16}
          tintColorClassName="accent-danger-foreground"
        />
      );
    case "cancelled":
      return (
        <SymbolView
          name="xmark.circle.fill"
          size={16}
          tintColorClassName="accent-foreground-muted"
        />
      );
  }
}

function MobileSmalltalkDetail({
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
      <Text>
        {AsyncResult.isFailure(detail)
          ? "Could not load this explanation."
          : "Loading explanation…"}
      </Text>
    );
  return <MobileSmalltalkContent threadRef={threadRef} record={detail.value} summary={summary} />;
}

function MobileSmalltalkContent({
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
  const navigation = useNavigation();
  const styles = useMarkdownPreviewStyles();
  const [busy, setBusy] = useState(false);
  const isGenerating = summary.status === "generating";
  const stale = record.status !== summary.status;
  const explanation = isGenerating ? summary.streamingText : stale ? "" : record.explanation;
  const model = record.modelSelection?.model ?? record.requestedModelSelection?.model ?? "未知";
  const apply = (input: SmalltalkMutation) => {
    setBusy(true);
    void mutate({ environmentId: threadRef.environmentId, input }).finally(() => setBusy(false));
  };
  const deleteWithConfirmation = () => {
    Alert.alert("删除这条解释？", undefined, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => apply({ action: "delete", threadId: threadRef.threadId, id: record.id }),
      },
    ]);
  };
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-sm text-foreground-muted" numberOfLines={1}>
          {model}
        </Text>
        <SymbolView
          name="sparkles"
          size={14}
          tintColorClassName="accent-foreground-muted"
          accessibilityLabel={`Preset: ${record.preset.name}`}
        />
        <View className="flex-row items-center">
          {record.filePath === null ? (
            <SmalltalkIconButton
              name="arrow.turn.left.up"
              label="跳转到原回答"
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
          ) : null}
          {explanation ? (
            <SmalltalkIconButton
              name="doc.on.doc"
              label="复制解释"
              onPress={() => {
                void copyTextWithHaptic(explanation);
              }}
            />
          ) : null}
          {allowed ? (
            isGenerating ? (
              <SmalltalkIconButton
                name="xmark"
                label="取消生成"
                disabled={busy}
                onPress={() =>
                  apply({ action: "cancel", threadId: threadRef.threadId, id: record.id })
                }
              />
            ) : (
              <SmalltalkIconButton
                name="arrow.clockwise"
                label={record.explanation ? "重新生成" : "重试"}
                disabled={busy}
                onPress={() =>
                  apply({ action: "regenerate", threadId: threadRef.threadId, id: record.id })
                }
              />
            )
          ) : null}
          {allowed ? (
            <SmalltalkIconButton
              name="trash"
              label="删除"
              disabled={busy}
              tintColorClassName="accent-danger-foreground"
              onPress={deleteWithConfirmation}
            />
          ) : null}
        </View>
      </View>
      {isGenerating || (stale && !explanation) ? (
        <View className="flex-row items-center gap-2">
          <AppActivityIndicator size="small" />
          <Text className="text-sm text-foreground-muted">
            {isGenerating ? "生成中…" : "载入中…"}
          </Text>
        </View>
      ) : null}
      {!isGenerating && record.error ? (
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {record.error}
        </Text>
      ) : null}
      {explanation ? (
        <SelectableMarkdownText markdown={explanation} textStyle={styles.nativeTextStyle} />
      ) : null}
    </View>
  );
}

function SmalltalkIconButton({
  name,
  label,
  onPress,
  disabled,
  tintColorClassName = "accent-foreground-muted",
}: {
  name: AppSymbolName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tintColorClassName?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className="size-9 items-center justify-center rounded-full active:opacity-60"
    >
      <SymbolView name={name} size={18} tintColorClassName={tintColorClassName} />
    </Pressable>
  );
}
