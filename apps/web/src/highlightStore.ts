import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { MessageId, type ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import type { AssistantTextSelector } from "./lib/assistantTextSelection";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  isHighlightColor,
  type HighlightColor,
} from "./lib/highlightColors";
import { randomUUID } from "./lib/utils";

export type { HighlightColor } from "./lib/highlightColors";

export const HIGHLIGHT_STORAGE_KEY = "t3code:thread-highlights:v2";
const LEGACY_HIGHLIGHT_STORAGE_KEY = "t3code:thread-highlights:v1";
export const HIGHLIGHT_COLOR_STORAGE_KEY = "t3code:highlight-color:v1";
export const HIGHLIGHT_COLOR_MODE_STORAGE_KEY = "t3code:highlight-color-mode:v1";
export const MAX_HIGHLIGHTS_PER_THREAD = 500;
export const MAX_HIGHLIGHT_TEXT_LENGTH = 4000;
export const MAX_HIGHLIGHT_NOTE_LENGTH = 2000;
const MAX_TOTAL_HIGHLIGHT_TEXT_LENGTH = 2_000_000;

export type HighlightColorMode = "thread" | "selection";
export const DEFAULT_HIGHLIGHT_COLOR_MODE: HighlightColorMode = "thread";

function isHighlightColorMode(value: unknown): value is HighlightColorMode {
  return value === "thread" || value === "selection";
}

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
  readonly comment?: string;
}

export interface HighlightNote {
  readonly id: string;
  readonly text: string;
}

export interface ThreadHighlight {
  readonly id: string;
  readonly source: ThreadHighlightSource;
  readonly selector: AssistantTextSelector;
  readonly color: HighlightColor;
  readonly createdAt: string;
  readonly notes?: readonly HighlightNote[];
}

export type AddHighlightResult =
  | { readonly ok: true; readonly highlight: ThreadHighlight }
  | { readonly ok: false; readonly reason: "too_long" | "limit" | "duplicate" | "storage" };

interface AddHighlightInput {
  readonly source: ThreadHighlightSource;
  readonly selector: AssistantTextSelector;
  readonly color?: HighlightColor;
}

interface HighlightStoreState {
  byThreadKey: Record<string, ThreadHighlight[]>;
  defaultColor: HighlightColor;
  colorMode: HighlightColorMode;
  threadDefaultColors: Record<string, HighlightColor>;
  addHighlight: (ref: ScopedThreadRef, input: AddHighlightInput) => AddHighlightResult;
  removeHighlights: (ref: ScopedThreadRef, ids: readonly string[]) => void;
  recolorHighlight: (ref: ScopedThreadRef, id: string, color: HighlightColor) => void;
  saveHighlightNote: (ref: ScopedThreadRef, id: string, text: string, noteId?: string) => boolean;
  removeHighlightNote: (ref: ScopedThreadRef, id: string, noteId: string) => boolean;
  setDefaultColor: (color: HighlightColor) => void;
  setColorMode: (mode: HighlightColorMode) => void;
  setThreadDefaultColor: (ref: ScopedThreadRef, color: HighlightColor) => void;
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

function readPersistedColorMode(): HighlightColorMode {
  if (typeof window === "undefined") return DEFAULT_HIGHLIGHT_COLOR_MODE;
  try {
    const value = window.localStorage.getItem(HIGHLIGHT_COLOR_MODE_STORAGE_KEY);
    return isHighlightColorMode(value) ? value : DEFAULT_HIGHLIGHT_COLOR_MODE;
  } catch {
    return DEFAULT_HIGHLIGHT_COLOR_MODE;
  }
}

function persistColorMode(mode: HighlightColorMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIGHLIGHT_COLOR_MODE_STORAGE_KEY, mode);
  } catch {}
}

function sanitizeThreadDefaultColors(value: unknown): Record<string, HighlightColor> {
  if (!value || typeof value !== "object") return {};
  const sanitized: Record<string, HighlightColor> = {};
  for (const [threadKey, color] of Object.entries(value)) {
    if (isHighlightColor(color)) sanitized[threadKey] = color;
  }
  return sanitized;
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

function isNoteText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_HIGHLIGHT_NOTE_LENGTH &&
    value.trim().length > 0
  );
}

function normalizeNotes(value: unknown, legacy: unknown, highlightId: string): HighlightNote[] {
  // The old explanation key was the highlight ID; keep it for the migrated note.
  if (!Array.isArray(value)) return isNoteText(legacy) ? [{ id: highlightId, text: legacy }] : [];
  const notes: HighlightNote[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const { id, text } = entry as Partial<HighlightNote>;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 128 ||
      seen.has(id) ||
      !isNoteText(text)
    )
      continue;
    notes.push({ id, text });
    seen.add(id);
  }
  return notes;
}

// Version 1 stored the assistant message id at the top level.
function normalizeThreadHighlight(value: unknown): ThreadHighlight | null {
  if (!value || typeof value !== "object") return null;
  const highlight = value as Partial<ThreadHighlight> & { messageId?: unknown; note?: unknown };
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
  if (source === null) return null;
  const notes = normalizeNotes(highlight.notes, highlight.note, highlight.id);
  return {
    id: highlight.id,
    source,
    selector: highlight.selector,
    color: highlight.color,
    createdAt: highlight.createdAt,
    ...(notes.length > 0 ? { notes } : {}),
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

function withoutNotes({ notes: _notes, ...rest }: ThreadHighlight): ThreadHighlight {
  return rest;
}

type HighlightData = Pick<HighlightStoreState, "byThreadKey" | "threadDefaultColors">;

function writeHighlightData(data: HighlightData): boolean {
  if (typeof window === "undefined") return true;
  try {
    window.localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify({ state: data, version: 4 }));
    return true;
  } catch {
    return false;
  }
}

function readHighlightData(): HighlightData {
  if (typeof window !== "undefined") {
    try {
      const current = window.localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
      const raw = current ?? window.localStorage.getItem(LEGACY_HIGHLIGHT_STORAGE_KEY);
      if (raw !== null) {
        const value: { state?: Partial<Record<keyof HighlightData, unknown>> } | null =
          JSON.parse(raw);
        const data = {
          byThreadKey: sanitizeThreadHighlights(value?.state?.byThreadKey),
          threadDefaultColors: sanitizeThreadDefaultColors(value?.state?.threadDefaultColors),
        };
        // An older client may rewrite its own key on load; never write the new shape there.
        if (current === null) writeHighlightData(data);
        return data;
      }
    } catch {}
  }
  return { byThreadKey: {}, threadDefaultColors: {} };
}

function readHighlightState() {
  return {
    ...readHighlightData(),
    defaultColor: readPersistedDefaultColor(),
    colorMode: readPersistedColorMode(),
  };
}

export const useHighlightStore = create<HighlightStoreState>()((set, get) => {
  const commit = (update: (data: HighlightData) => Partial<HighlightData>) => {
    const { byThreadKey, threadDefaultColors } = get();
    const current = { byThreadKey, threadDefaultColors };
    const next = { ...current, ...update(current) };
    if (!writeHighlightData(next)) return false;
    set(next);
    return true;
  };
  return {
    ...readHighlightState(),
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
      const fallbackColor = get().threadDefaultColors[threadKey] ?? get().defaultColor;
      const highlight: ThreadHighlight = {
        id: randomUUID(),
        source: input.source,
        selector: input.selector,
        color:
          input.color !== undefined && isHighlightColor(input.color) ? input.color : fallbackColor,
        createdAt: new Date().toISOString(),
      };
      return commit((state) => ({
        byThreadKey: { ...state.byThreadKey, [threadKey]: [...highlights, highlight] },
      }))
        ? { ok: true, highlight }
        : { ok: false, reason: "storage" };
    },
    removeHighlights: (ref, ids) => {
      const threadKey = scopedThreadKey(ref);
      const existing = get().byThreadKey[threadKey];
      if (!existing) return;
      const removed = new Set(ids);
      const next = existing.filter((highlight) => !removed.has(highlight.id));
      if (next.length === existing.length) return;
      commit((state) => {
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
      commit((state) => ({
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: (state.byThreadKey[threadKey] ?? []).map((highlight) =>
            highlight.id === id ? { ...highlight, color } : highlight,
          ),
        },
      }));
    },
    saveHighlightNote: (ref, id, text, noteId) => {
      if (!isNoteText(text)) return false;
      const threadKey = scopedThreadKey(ref);
      const existing = get().byThreadKey[threadKey];
      const highlight = existing?.find((highlight) => highlight.id === id);
      if (!existing || !highlight) return false;
      const notes = highlight.notes ?? [];
      const trimmed = text.trim();
      if (noteId !== undefined) {
        const note = notes.find((note) => note.id === noteId);
        if (!note) return false;
        if (note.text === trimmed) return true;
      }
      const nextNotes =
        noteId === undefined
          ? [...notes, { id: randomUUID(), text: trimmed }]
          : notes.map((note) => (note.id === noteId ? { ...note, text: trimmed } : note));
      return commit((state) => ({
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: existing.map((item) =>
            item === highlight ? { ...highlight, notes: nextNotes } : item,
          ),
        },
      }));
    },
    removeHighlightNote: (ref, id, noteId) => {
      const threadKey = scopedThreadKey(ref);
      const existing = get().byThreadKey[threadKey];
      const highlight = existing?.find((highlight) => highlight.id === id);
      if (!existing || !highlight?.notes?.some((note) => note.id === noteId)) return false;
      const notes = highlight.notes.filter((note) => note.id !== noteId);
      const next = notes.length > 0 ? { ...highlight, notes } : withoutNotes(highlight);
      return commit((state) => ({
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: existing.map((item) => (item === highlight ? next : item)),
        },
      }));
    },
    setDefaultColor: (color) => {
      if (!isHighlightColor(color) || get().defaultColor === color) return;
      set({ defaultColor: color });
      persistDefaultColor(color);
    },
    setColorMode: (mode) => {
      if (!isHighlightColorMode(mode) || get().colorMode === mode) return;
      set({ colorMode: mode });
      persistColorMode(mode);
    },
    setThreadDefaultColor: (ref, color) => {
      if (!isHighlightColor(color)) return;
      const threadKey = scopedThreadKey(ref);
      if (get().threadDefaultColors[threadKey] === color) return;
      commit((state) => ({
        threadDefaultColors: { ...state.threadDefaultColors, [threadKey]: color },
      }));
    },
    clearThread: (ref) => {
      const threadKey = scopedThreadKey(ref);
      const { byThreadKey, threadDefaultColors } = get();
      if (!byThreadKey[threadKey] && !threadDefaultColors[threadKey]) return;
      commit((state) => {
        const nextByThreadKey = { ...state.byThreadKey };
        delete nextByThreadKey[threadKey];
        const nextThreadDefaultColors = { ...state.threadDefaultColors };
        delete nextThreadDefaultColors[threadKey];
        return { byThreadKey: nextByThreadKey, threadDefaultColors: nextThreadDefaultColors };
      });
    },
  };
});

export function rehydrateHighlights() {
  useHighlightStore.setState(readHighlightState());
}

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

export function useHighlightColorMode(): HighlightColorMode {
  return useHighlightStore((state) => state.colorMode);
}

export function useThreadDefaultColor(ref: ScopedThreadRef | null): HighlightColor {
  return useHighlightStore((state) =>
    ref === null
      ? state.defaultColor
      : (state.threadDefaultColors[scopedThreadKey(ref)] ?? state.defaultColor),
  );
}
