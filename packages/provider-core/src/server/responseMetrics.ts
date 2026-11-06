import type { OrchestrationV2ProviderTurn, ProviderTurnId } from "@t3tools/contracts";
import type * as Clock from "effect/Clock";
import type { ProviderAdapterV2Event } from "./ProviderAdapter.ts";

type Metrics = NonNullable<OrchestrationV2ProviderTurn["responseMetrics"]>;
type Window = { start: number; end: number; samples: number; tokens: number };
type Text = { units: number; length: number; hash: number; lastCode: number; window?: Window };
type Turn = {
  texts: Map<string, Text>;
  windows: Window[];
  firstOutputObservedAtMs?: number;
  firstOutputMonotonicMs?: number;
  maxGapMs: number;
  longGapCount: number;
  invalid?: Metrics["unavailableReason"];
  startedTools: Set<string>;
  finalTexts: Map<string, { units: number; hash: number }>;
};

function scan(value: string, units = 0, hash = 0, lastCode = 0) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const paired = code >= 0xdc00 && code <= 0xdfff && lastCode >= 0xd800 && lastCode <= 0xdbff;
    units += paired ? 0 : code <= 0x7f ? 1 : 4;
    hash = (Math.imul(hash, 31) + code) | 0;
    lastCode = code;
  }
  return { units, hash, lastCode };
}

/** Raw adapter observations stay in memory; only existing terminal turn updates carry metrics. */
export function makeProviderResponseMetrics(
  clock: Pick<Clock.Clock, "monotonicTimeNanosUnsafe" | "currentTimeMillisUnsafe">,
) {
  const turns = new Map<ProviderTurnId, Turn>();
  const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
  const closeWindow = (turn: Turn, text: Text) => {
    if (text.window === undefined) return;
    if (turn.windows.length < 4096) turn.windows.push(text.window);
    else turn.invalid = "incomplete_turn";
    delete text.window;
  };
  const boundary = (turnId: ProviderTurnId) => {
    const turn = turns.get(turnId);
    if (turn) for (const text of turn.texts.values()) closeWindow(turn, text);
  };
  const finishText = (turnId: ProviderTurnId, key: string, finalText?: string) => {
    const turn = turns.get(turnId);
    if (!turn) return;
    const text = turn.texts.get(key);
    if (finalText !== undefined) {
      const final = scan(finalText);
      if (finalText.length !== (text?.length ?? 0) || final.hash !== (text?.hash ?? 0)) {
        turn.invalid = "snapshot_changed";
      }
    }
    if (text) closeWindow(turn, text);
  };
  return {
    append(turnId: ProviderTurnId, key: string, delta: string) {
      const turn = turns.get(turnId);
      if (!turn || delta.length === 0) return;
      if (!turn.texts.has(key) && turn.texts.size >= 4096) {
        turn.invalid = "incomplete_turn";
        return;
      }
      const at = now();
      const text = turn.texts.get(key) ?? { units: 0, length: 0, hash: 0, lastCode: 0 };
      const before = Math.ceil(text.units / 4);
      Object.assign(text, scan(delta, text.units, text.hash, text.lastCode));
      text.length += delta.length;
      if (delta.trim().length > 0 && turn.firstOutputObservedAtMs === undefined) {
        turn.firstOutputObservedAtMs = clock.currentTimeMillisUnsafe();
        turn.firstOutputMonotonicMs = at;
      }
      if (text.window === undefined) {
        text.window = { start: at, end: at, samples: 1, tokens: 0 };
      } else {
        const gap = at - text.window.end;
        if (gap < 0) turn.invalid = "clock_discontinuity";
        turn.maxGapMs = Math.max(turn.maxGapMs, gap);
        if (gap >= 500) turn.longGapCount++;
        text.window.end = at;
        text.window.samples++;
        text.window.tokens += Math.ceil(text.units / 4) - before;
      }
      turn.texts.set(key, text);
    },
    finishText,
    invalidate(turnId: ProviderTurnId) {
      const turn = turns.get(turnId);
      if (turn) turn.invalid = "incomplete_turn";
    },
    boundary,
    observe(event: ProviderAdapterV2Event): ProviderAdapterV2Event {
      if (event.type === "provider_turn.updated") {
        const providerTurn = event.providerTurn;
        if (providerTurn.runAttemptId === null) return event;
        let turn = turns.get(providerTurn.id);
        if (providerTurn.status === "running") {
          if (!turn) {
            turn = {
              texts: new Map(),
              windows: [],
              maxGapMs: 0,
              longGapCount: 0,
              startedTools: new Set(),
              finalTexts: new Map(),
            };
            turns.set(providerTurn.id, turn);
          }
          return event;
        }
        if (!turn || providerTurn.status === "pending") return event;
        boundary(providerTurn.id);
        turns.delete(providerTurn.id);
        const windows = turn.windows;
        let duration = 0;
        let end = -Infinity;
        for (const window of windows.toSorted((a, b) => a.start - b.start)) {
          duration += Math.max(0, window.end - Math.max(window.start, end));
          end = Math.max(end, window.end);
        }
        const tokenCount = windows.reduce((sum, window) => sum + window.tokens, 0);
        const sampleCount = windows.reduce((sum, window) => sum + window.samples, 0);
        const totalTokens = [...turn.texts.values()].reduce(
          (sum, text) => sum + Math.ceil(text.units / 4),
          0,
        );
        const durationMs = Math.max(0, Math.round(duration));
        const rawUnits = [...turn.texts.values()].reduce((sum, text) => sum + text.units, 0);
        const finalUnits = [...turn.finalTexts.values()].reduce((sum, text) => sum + text.units, 0);
        const rawHash = [...turn.texts.values()].reduce((sum, text) => (sum + text.hash) | 0, 0);
        const finalHash = [...turn.finalTexts.values()].reduce(
          (sum, text) => (sum + text.hash) | 0,
          0,
        );
        if (turn.finalTexts.size > 0 && (rawUnits !== finalUnits || rawHash !== finalHash))
          turn.invalid = "snapshot_changed";
        const unavailableReason =
          turn.invalid ??
          (providerTurn.status !== "completed"
            ? "incomplete_turn"
            : sampleCount === 0
              ? "unsupported_provider"
              : sampleCount < 5 || tokenCount <= 1
                ? "insufficient_samples"
                : windows.some(
                      (window) =>
                        window.samples > 1 &&
                        (window.end - window.start) / (window.samples - 1) < 1,
                    )
                  ? "buffered_output"
                  : durationMs < 200
                    ? "short_window"
                    : undefined);
        const responseMetrics: Metrics = {
          version: 2,
          kind: "visible_stream",
          tokenScope: "visible_text",
          tokenSource: "text_estimate",
          timingSource: "server_monotonic",
          tokenCount,
          durationMs,
          sampleCount,
          maxGapMs: Math.max(0, Math.round(turn.maxGapMs)),
          longGapCount: turn.longGapCount,
          excludedInitialTokens: Math.max(0, totalTokens - tokenCount),
          ...(turn.firstOutputObservedAtMs === undefined
            ? {}
            : { firstOutputObservedAtMs: turn.firstOutputObservedAtMs }),
          ...(unavailableReason === undefined
            ? { tokensPerSecond: (tokenCount * 1000) / durationMs }
            : { unavailableReason }),
        };
        return {
          ...event,
          ...(turn.firstOutputMonotonicMs === undefined
            ? {}
            : {
                responseMetricsFirstOutputMonotonicMs: turn.firstOutputMonotonicMs,
              }),
          providerTurn: { ...providerTurn, responseMetrics },
        };
      }
      const request = event.type === "runtime_request.updated" ? event.runtimeRequest : undefined;
      const item = event.type === "turn_item.updated" ? event.turnItem : undefined;
      const key = request ? `request:${request.id}` : item ? `item:${item.id}` : undefined;
      const turnId = request?.providerTurnId ?? item?.providerTurnId;
      const blocked =
        request?.status === "pending" ||
        (item &&
          [
            "command_execution",
            "mcp_tool_call",
            "dynamic_tool",
            "file_change",
            "web_search",
            "approval_request",
            "user_input_request",
            "error",
          ].includes(item.type));
      const turn = turnId ? turns.get(turnId) : undefined;
      if (turnId && key && blocked && turn && !turn.startedTools.has(key)) {
        turn.startedTools.add(key);
        boundary(turnId);
      }
      if (
        item &&
        item.providerTurnId &&
        item.runId !== null &&
        (item.type === "assistant_message" || item.type === "reasoning") &&
        !item.streaming &&
        item.text.length > 0
      ) {
        const turn = turns.get(item.providerTurnId);
        if (turn) {
          if (!turn.finalTexts.has(item.id) && turn.finalTexts.size >= 4096)
            turn.invalid = "incomplete_turn";
          else turn.finalTexts.set(item.id, scan(item.text));
          const nativeId = item.nativeItemRef?.nativeId;
          if (nativeId && turn.texts.has(nativeId))
            finishText(item.providerTurnId, nativeId, item.text);
        }
      }
      return event;
    },
  };
}
