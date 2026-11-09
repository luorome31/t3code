import type { MessageId } from "@t3tools/contracts";
import { create } from "zustand";
import { toastManager } from "../ui/toast";

interface OutlineNavigation {
  readonly activeMessageId: MessageId | null;
  readonly revealId: number;
  readonly request: {
    readonly id: number;
    readonly messageId: MessageId;
    readonly headingIndex: number;
  } | null;
}

const EMPTY_OUTLINE_NAVIGATION: OutlineNavigation = {
  activeMessageId: null,
  revealId: 0,
  request: null,
};

export const useOutlineStore = create<{
  readonly byThreadKey: Readonly<Record<string, OutlineNavigation>>;
}>(() => ({ byThreadKey: {} }));

const timelines = new Map<string, () => void>();

export function attachOutlineTimeline(threadKey: string, navigate: () => void) {
  timelines.set(threadKey, navigate);
  return () => {
    if (timelines.get(threadKey) !== navigate) return;
    timelines.delete(threadKey);
    useOutlineStore.setState(({ byThreadKey }) => {
      const { [threadKey]: _removed, ...rest } = byThreadKey;
      return { byThreadKey: rest };
    });
  };
}

export function reportOutlineActiveMessage(threadKey: string, messageId: MessageId | null) {
  const state = useOutlineStore.getState();
  const current = state.byThreadKey[threadKey] ?? EMPTY_OUTLINE_NAVIGATION;
  // A jump is in flight; the target owns the panel until the list settles.
  if (current.request !== null || current.activeMessageId === messageId) return;
  useOutlineStore.setState({
    byThreadKey: {
      ...state.byThreadKey,
      [threadKey]: { ...current, activeMessageId: messageId },
    },
  });
}

export function requestOutlineNavigation(
  threadKey: string,
  messageId: MessageId,
  headingIndex: number,
) {
  const navigate = timelines.get(threadKey);
  if (!navigate) return;
  navigate();
  useOutlineStore.setState(({ byThreadKey }) => {
    const current = byThreadKey[threadKey] ?? EMPTY_OUTLINE_NAVIGATION;
    const id = current.revealId + 1;
    return {
      byThreadKey: {
        ...byThreadKey,
        [threadKey]: {
          ...current,
          activeMessageId: messageId,
          revealId: id,
          request: { id, messageId, headingIndex },
        },
      },
    };
  });
}

export function settleOutlineNavigation(threadKey: string, id: number, error: string | null) {
  if (error && useOutlineStore.getState().byThreadKey[threadKey]?.request?.id === id) {
    toastManager.add({ type: "warning", title: "Could not jump to section", description: error });
  }
  useOutlineStore.setState(({ byThreadKey }) => {
    const current = byThreadKey[threadKey];
    if (current?.request?.id !== id) return { byThreadKey };
    return { byThreadKey: { ...byThreadKey, [threadKey]: { ...current, request: null } } };
  });
}
