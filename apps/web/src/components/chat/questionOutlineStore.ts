import type { OrchestrationV2Question } from "@t3tools/contracts";
import { create } from "zustand";
import { toastManager } from "../ui/toast";

interface QuestionNavigation {
  readonly currentMessageId: string | null;
  readonly currentTimestamp: string | null;
  readonly request: { readonly id: number; readonly question: OrchestrationV2Question } | null;
  readonly error: string | null;
  readonly revealId: number;
}

export const EMPTY_QUESTION_NAVIGATION: QuestionNavigation = {
  currentMessageId: null,
  currentTimestamp: null,
  request: null,
  error: null,
  revealId: 0,
};

export const useQuestionOutlineStore = create<{
  readonly byThreadKey: Readonly<Record<string, QuestionNavigation>>;
}>(() => ({ byThreadKey: {} }));

const timelines = new Map<string, () => void>();

export function attachQuestionTimeline(threadKey: string, navigate: () => void) {
  timelines.set(threadKey, navigate);
  return () => {
    if (timelines.get(threadKey) !== navigate) return;
    timelines.delete(threadKey);
    useQuestionOutlineStore.setState(({ byThreadKey }) => {
      const { [threadKey]: _removed, ...rest } = byThreadKey;
      return { byThreadKey: rest };
    });
  };
}

export function reportQuestionPosition(
  threadKey: string,
  currentMessageId: string | null,
  currentTimestamp: string | null = null,
) {
  const state = useQuestionOutlineStore.getState();
  const current = state.byThreadKey[threadKey] ?? EMPTY_QUESTION_NAVIGATION;
  if (
    current.currentMessageId === currentMessageId &&
    current.currentTimestamp === currentTimestamp
  )
    return;
  useQuestionOutlineStore.setState({
    byThreadKey: {
      ...state.byThreadKey,
      [threadKey]: { ...current, currentMessageId, currentTimestamp },
    },
  });
}

export function requestQuestionNavigation(threadKey: string, question: OrchestrationV2Question) {
  const navigate = timelines.get(threadKey);
  if (!navigate) return;
  navigate();
  useQuestionOutlineStore.setState(({ byThreadKey }) => {
    const current = byThreadKey[threadKey] ?? EMPTY_QUESTION_NAVIGATION;
    const id = current.revealId + 1;
    return {
      byThreadKey: {
        ...byThreadKey,
        [threadKey]: {
          ...current,
          request: { id, question },
          error: null,
          revealId: id,
        },
      },
    };
  });
}

export function settleQuestionNavigation(threadKey: string, id: number, error: string | null) {
  if (error && useQuestionOutlineStore.getState().byThreadKey[threadKey]?.request?.id === id) {
    toastManager.add({ type: "warning", title: "Could not jump to question", description: error });
  }
  useQuestionOutlineStore.setState(({ byThreadKey }) => {
    const current = byThreadKey[threadKey];
    if (current?.request?.id !== id) return { byThreadKey };
    return { byThreadKey: { ...byThreadKey, [threadKey]: { ...current, request: null, error } } };
  });
}
