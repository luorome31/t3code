import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import type { AssistantTextSelector } from "./lib/assistantTextSelection";

interface StoredReveal {
  readonly id: number;
  readonly selector: AssistantTextSelector;
}

interface FileHighlightRevealState {
  byFileKey: Record<string, StoredReveal>;
  request: (input: {
    environmentId: EnvironmentId;
    workspaceRoot: string;
    relativePath: string;
    selector: AssistantTextSelector;
  }) => void;
  consume: (input: {
    environmentId: EnvironmentId;
    workspaceRoot: string;
    relativePath: string;
    id: number;
  }) => void;
}

let nextRevealId = 0;

function revealKey(environmentId: EnvironmentId, workspaceRoot: string, relativePath: string) {
  return `${environmentId}\u0000${workspaceRoot}\u0000${relativePath}`;
}

const useFileHighlightRevealStore = create<FileHighlightRevealState>()((set, get) => ({
  byFileKey: {},
  request: (input) => {
    nextRevealId += 1;
    const key = revealKey(input.environmentId, input.workspaceRoot, input.relativePath);
    set((state) => ({
      byFileKey: {
        ...state.byFileKey,
        [key]: { id: nextRevealId, selector: input.selector },
      },
    }));
  },
  consume: (input) => {
    const key = revealKey(input.environmentId, input.workspaceRoot, input.relativePath);
    if (get().byFileKey[key]?.id !== input.id) return;
    set((state) => {
      const byFileKey = { ...state.byFileKey };
      delete byFileKey[key];
      return { byFileKey };
    });
  },
}));

export function useFileHighlightReveal(input: {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly relativePath: string | null;
}): StoredReveal | null {
  const { environmentId, workspaceRoot, relativePath } = input;
  return useFileHighlightRevealStore((state) =>
    relativePath === null
      ? null
      : (state.byFileKey[revealKey(environmentId, workspaceRoot, relativePath)] ?? null),
  );
}

export function requestFileHighlightReveal(input: {
  environmentId: EnvironmentId;
  workspaceRoot: string;
  relativePath: string;
  selector: AssistantTextSelector;
}): void {
  useFileHighlightRevealStore.getState().request(input);
}

export function consumeFileHighlightReveal(input: {
  environmentId: EnvironmentId;
  workspaceRoot: string;
  relativePath: string;
  id: number;
}): void {
  useFileHighlightRevealStore.getState().consume(input);
}
