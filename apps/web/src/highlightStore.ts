import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { MessageId, type ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { AssistantTextSelector } from "./lib/assistantTextSelection";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  isHighlightColor,
  type HighlightColor,
} from "./lib/highlightColors";
import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

export const HIGHLIGHT_STORAGE_KEY = "t3code:thread-highlights:v1";
export const HIGHLIGHT_COLOR_STORAGE_KEY = "t3code:highlight-color:v1";
export const MAX_HIGHLIGHTS_PER_THREAD = 500;
export const MAX_HIGHLIGHT_TEXT_LENGTH = 4000;
const MAX_TOTAL_HIGHLIGHT_TEXT_LENGTH = 2_000_000;

export type ThreadHighlightSource =
  | { readonly kind: "assistant-message"; readonly messageId: MessageId }
  | {
      readonly kind: "markdown-file";
      readonly workspaceRoot: string;
      readonly relativePath: string;
    };

export interface MarkdownFileHighlightExcerpt {
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly text: string;
}

export interface ThreadHighlight {
  readonly id: string;
  readonly source: ThreadHighlightSource;
  readonly selector: AssistantTextSelector;
  readonly color: HighlightColor;
  readonly createdAt: string;
}

export type AddHighlightResult =
  | { readonly ok: true; readonly highlight: ThreadHighlight }
  | { readonly ok: false; readonly reason: "too_long" | "limit" | "duplicate" };

interface AddHighlightInput {
  readonly source: ThreadHighlightSource;
  readonly selector: AssistantTextSelector;
  readonly color?: HighlightColor;
}

interface HighlightStoreState {
  byThreadKey: Record<string, ThreadHighlight[]>;
  defaultColor: HighlightColor;
  addHighlight: (ref: ScopedThreadRef, input: AddHighlightInput) => AddHighlightResult;
  removeHighlights: (ref: ScopedThreadRef, ids: readonly string[]) => void;
  recolorHighlight: (ref: ScopedThreadRef, id: string, color: HighlightColor) => void;
  setDefaultColor: (color: HighlightColor) => void;
  clearThread: (ref: ScopedThreadRef) => void;
}

const EMPTY_HIGHLIGHTS: readonly ThreadHighlight[] = [];

function readPersistedDefaultColor(): HighlightColor {
  if (typeof window === "undefined") return DEFAULT_HIGHLIGHT_COLOR;
  try {
    const value = window.localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEY);
    return isHighlightColor(value) ? value : DEFAULT_HIGHLIGHT_COLOR;
  } catch {
    return DEFAULT_HIGHLIGHT_COLOR;
  }
}

function persistDefaultColor(color: HighlightColor): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIGHLIGHT_COLOR_STORAGE_KEY, color);
  } catch {}
}

export function sameHighlightSelector(
  left: AssistantTextSelector,
  right: AssistantTextSelector,
): boolean {
  return left.text === right.text && left.start === right.start && left.end === right.end;
}

export function sameHighlightSource(
  left: ThreadHighlightSource,
  right: ThreadHighlightSource,
): boolean {
  if (left.kind === "assistant-message") {
    return right.kind === "assistant-message" && left.messageId === right.messageId;
  }
  return (
    right.kind === "markdown-file" &&
    left.workspaceRoot === right.workspaceRoot &&
    left.relativePath === right.relativePath
  );
}

function isSelector(value: unknown): value is AssistantTextSelector {
  if (!value || typeof value !== "object") return false;
  const selector = value as Partial<AssistantTextSelector>;
  return (
    typeof selector.text === "string" &&
    selector.text.length <= MAX_HIGHLIGHT_TEXT_LENGTH &&
    typeof selector.start === "number" &&
    typeof selector.end === "number" &&
    Number.isSafeInteger(selector.start) &&
    Number.isSafeInteger(selector.end) &&
    selector.start >= 0 &&
    selector.end >= selector.start &&
    typeof selector.prefix === "string" &&
    typeof selector.suffix === "string"
  );
}

function isHighlightSource(value: unknown): value is ThreadHighlightSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<ThreadHighlightSource>;
  if (source.kind === "assistant-message") {
    return typeof source.messageId === "string" && source.messageId.length > 0;
  }
  if (source.kind === "markdown-file") {
    return (
      typeof source.workspaceRoot === "string" &&
      source.workspaceRoot.length > 0 &&
      typeof source.relativePath === "string" &&
      source.relativePath.length > 0
    );
  }
  return false;
}

// Version 1 stored the assistant message id at the top level.
function normalizeThreadHighlight(value: unknown): ThreadHighlight | null {
  if (!value || typeof value !== "object") return null;
  const highlight = value as Partial<ThreadHighlight> & { messageId?: unknown };
  if (
    typeof highlight.id !== "string" ||
    typeof highlight.createdAt !== "string" ||
    !isHighlightColor(highlight.color) ||
    !isSelector(highlight.selector)
  ) {
    return null;
  }
  let source: ThreadHighlightSource | null = isHighlightSource(highlight.source)
    ? highlight.source
    : null;
  if (
    source === null &&
    typeof highlight.messageId === "string" &&
    highlight.messageId.length > 0
  ) {
    try {
      source = { kind: "assistant-message", messageId: MessageId.make(highlight.messageId) };
    } catch {
      return null;
    }
  }
  return source === null
    ? null
    : {
        id: highlight.id,
        source,
        selector: highlight.selector,
        color: highlight.color,
        createdAt: highlight.createdAt,
      };
}

function sanitizeThreadHighlights(value: unknown): Record<string, ThreadHighlight[]> {
  if (!value || typeof value !== "object") return {};
  const sanitized: Record<string, ThreadHighlight[]> = {};
  for (const [threadKey, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    const seen = new Set<string>();
    const highlights = entries.flatMap((entry) => {
      const highlight = normalizeThreadHighlight(entry);
      if (highlight === null || seen.has(highlight.id)) return [];
      seen.add(highlight.id);
      return [highlight];
    });
    if (highlights.length > 0) {
      sanitized[threadKey] = highlights.slice(0, MAX_HIGHLIGHTS_PER_THREAD);
    }
  }
  return sanitized;
}

function totalHighlightTextLength(byThreadKey: Record<string, ThreadHighlight[]>): number {
  return Object.values(byThreadKey).reduce(
    (total, highlights) =>
      total +
      highlights.reduce(
        (threadTotal, highlight) => threadTotal + highlight.selector.text.length,
        0,
      ),
    0,
  );
}

export const useHighlightStore = create<HighlightStoreState>()(
  persist(
    (set, get) => ({
      byThreadKey: {},
      defaultColor: readPersistedDefaultColor(),
      addHighlight: (ref, input) => {
        const threadKey = scopedThreadKey(ref);
        const highlights = get().byThreadKey[threadKey] ?? [];
        if (input.selector.text.length > MAX_HIGHLIGHT_TEXT_LENGTH) {
          return { ok: false, reason: "too_long" };
        }
        if (highlights.length >= MAX_HIGHLIGHTS_PER_THREAD) {
          return { ok: false, reason: "limit" };
        }
        if (
          totalHighlightTextLength(get().byThreadKey) + input.selector.text.length >
          MAX_TOTAL_HIGHLIGHT_TEXT_LENGTH
        ) {
          return { ok: false, reason: "limit" };
        }
        if (
          highlights.some(
            (highlight) =>
              sameHighlightSource(highlight.source, input.source) &&
              sameHighlightSelector(highlight.selector, input.selector),
          )
        ) {
          return { ok: false, reason: "duplicate" };
        }
        const highlight: ThreadHighlight = {
          id: randomUUID(),
          source: input.source,
          selector: input.selector,
          color:
            input.color !== undefined && isHighlightColor(input.color)
              ? input.color
              : get().defaultColor,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [threadKey]: [...(state.byThreadKey[threadKey] ?? []), highlight],
          },
        }));
        return { ok: true, highlight };
      },
      removeHighlights: (ref, ids) => {
        const threadKey = scopedThreadKey(ref);
        const existing = get().byThreadKey[threadKey];
        if (!existing) return;
        const removed = new Set(ids);
        const next = existing.filter((highlight) => !removed.has(highlight.id));
        if (next.length === existing.length) return;
        set((state) => {
          const byThreadKey = { ...state.byThreadKey };
          if (next.length === 0) delete byThreadKey[threadKey];
          else byThreadKey[threadKey] = next;
          return { byThreadKey };
        });
      },
      recolorHighlight: (ref, id, color) => {
        if (!isHighlightColor(color)) return;
        const threadKey = scopedThreadKey(ref);
        const existing = get().byThreadKey[threadKey];
        if (!existing?.some((highlight) => highlight.id === id && highlight.color !== color)) {
          return;
        }
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [threadKey]: (state.byThreadKey[threadKey] ?? []).map((highlight) =>
              highlight.id === id ? { ...highlight, color } : highlight,
            ),
          },
        }));
      },
      setDefaultColor: (color) => {
        if (!isHighlightColor(color) || get().defaultColor === color) return;
        set({ defaultColor: color });
        persistDefaultColor(color);
      },
      clearThread: (ref) => {
        const threadKey = scopedThreadKey(ref);
        if (!get().byThreadKey[threadKey]) return;
        set((state) => {
          const byThreadKey = { ...state.byThreadKey };
          delete byThreadKey[threadKey];
          return { byThreadKey };
        });
      },
    }),
    {
      name: HIGHLIGHT_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
      migrate: (persistedState) => persistedState as HighlightStoreState,
      merge: (persisted, current) => {
        const value =
          persisted && typeof persisted === "object"
            ? (persisted as { byThreadKey?: unknown })
            : {};
        return {
          ...current,
          byThreadKey: sanitizeThreadHighlights(value.byThreadKey),
          defaultColor: readPersistedDefaultColor(),
        };
      },
    },
  ),
);

export function readThreadHighlights(ref: ScopedThreadRef): readonly ThreadHighlight[] {
  return useHighlightStore.getState().byThreadKey[scopedThreadKey(ref)] ?? EMPTY_HIGHLIGHTS;
}

export function useThreadHighlights(ref: ScopedThreadRef | null): readonly ThreadHighlight[] {
  return useHighlightStore((state) =>
    ref === null ? EMPTY_HIGHLIGHTS : (state.byThreadKey[scopedThreadKey(ref)] ?? EMPTY_HIGHLIGHTS),
  );
}

export function useThreadHighlightCount(ref: ScopedThreadRef | null): number {
  return useHighlightStore((state) =>
    ref === null ? 0 : (state.byThreadKey[scopedThreadKey(ref)]?.length ?? 0),
  );
}

export function useDefaultHighlightColor(): HighlightColor {
  return useHighlightStore((state) => state.defaultColor);
}
