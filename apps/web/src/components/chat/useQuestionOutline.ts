import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useQuietThreadProjection } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useClientSettings } from "../../hooks/useSettings";
import { EMPTY_QUESTION_NAVIGATION, useQuestionOutlineStore } from "./questionOutlineStore";
import { currentQuestionIndex, questionNavigationTargets } from "./questionOutline.logic";

export function useQuestionOutline(threadRef: ScopedThreadRef) {
  const enabled = useClientSettings((settings) => settings.conversationNavigation === "questions");
  const thread = useQuietThreadProjection(enabled ? threadRef : null);
  const revision =
    thread?.projection.visibleTurnItems
      .filter(({ item }) => item.type === "user_message")
      .map(({ sourceItemId }) => sourceItemId)
      .join(",") ?? "";
  const query = useEnvironmentQuery(
    enabled && thread !== null
      ? orchestrationEnvironment.threadQuestions({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, revision },
        })
      : null,
  );
  const threadKey = scopedThreadKey(threadRef);
  const navigation = useQuestionOutlineStore(
    (state) => state.byThreadKey[threadKey] ?? EMPTY_QUESTION_NAVIGATION,
  );
  const questions = query.data?.items ?? [];
  const currentIndex = currentQuestionIndex(
    questions,
    navigation.currentMessageId,
    navigation.currentTimestamp,
  );
  const currentMessageId = questions[currentIndex]?.messageId ?? null;
  const refresh = () => {
    useQuestionOutlineStore.setState(({ byThreadKey }) => {
      const current = byThreadKey[threadKey];
      return current?.error
        ? { byThreadKey: { ...byThreadKey, [threadKey]: { ...current, error: null } } }
        : { byThreadKey };
    });
    query.refresh();
  };
  return {
    ...query,
    ...navigation,
    enabled,
    questions,
    threadKey,
    error: navigation.error ?? query.error,
    currentMessageId,
    refresh,
    total: query.data?.total ?? 0,
    ...questionNavigationTargets(questions, currentMessageId),
  };
}
