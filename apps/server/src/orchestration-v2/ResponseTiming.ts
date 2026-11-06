import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2TurnItem,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type { ProviderAdapterV2Event } from "@t3tools/provider-core/server/ProviderAdapter";

type Timing = NonNullable<OrchestrationV2ProviderTurn["responseTiming"]>;
type Observation = NonNullable<OrchestrationV2TurnItem["outputObservation"]>;

function visibleTokenUnits(text: string, from: number) {
  let units = 0;
  for (let index = from; index < text.length; index++) {
    const code = text.charCodeAt(index);
    // A low surrogate can arrive in a later chunk than its high surrogate.
    if (code >= 0xdc00 && code <= 0xdfff && index > 0) {
      const previous = text.charCodeAt(index - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) continue;
    }
    units += code <= 0x7f ? 1 : 4;
  }
  return units;
}

export function makeResponseTimingCollector(owner: {
  threadId: ThreadId;
  runId: RunId;
  attemptId: RunAttemptId;
  providerThreadId: ProviderThreadId;
}) {
  let executionStartedAtMs: number | undefined;
  let executionStartedMonotonicMs: number | undefined;
  const turns = new Map<ProviderTurnId, Timing>();
  const lastOutputAt = new Map<ProviderTurnId, number>();
  const outputStates = new Map<string, { length: number; units: number; hasOutput: boolean }>();
  const outputUnits = new Map<ProviderTurnId, number>();
  const startedTools = new Set<string>();
  const rawWindows = new Map<ProviderTurnId, Map<string, Observation>>();
  return {
    start(nowMs: number, monotonicMs?: number) {
      executionStartedAtMs ??= nowMs;
      executionStartedMonotonicMs ??= monotonicMs;
    },
    observe(event: ProviderAdapterV2Event, nowMs: number): ProviderAdapterV2Event {
      if (executionStartedAtMs === undefined) return event;
      if (event.type === "provider_turn.updated") {
        const turn = event.providerTurn;
        if (
          turn.runAttemptId !== owner.attemptId ||
          turn.providerThreadId !== owner.providerThreadId
        )
          return event;
        const previous = turns.get(turn.id);
        if (previous === undefined && turn.status !== "running") return event;
        const windows = rawWindows.get(turn.id);
        let observedOutputDurationMs = 0;
        let lastEnd = 0;
        for (const window of [...(windows?.values() ?? [])].sort(
          (a, b) => a.firstObservedAtMs - b.firstObservedAtMs,
        )) {
          observedOutputDurationMs += Math.max(
            0,
            window.lastObservedAtMs - Math.max(lastEnd, window.firstObservedAtMs),
          );
          lastEnd = Math.max(lastEnd, window.lastObservedAtMs);
        }
        const timing: Timing = {
          ...(previous ?? {
            version: 1,
            executionStartedAtMs: turns.size === 0 ? executionStartedAtMs : nowMs,
          }),
          ...(windows === undefined
            ? {}
            : {
                observedOutputDurationMs,
                outputSampleCount: [...windows.values()].reduce(
                  (count, window) => count + window.sampleCount,
                  0,
                ),
              }),
          ...(previous?.firstOutputObservedAtMs !== undefined && outputUnits.has(turn.id)
            ? { estimatedVisibleOutputTokens: Math.ceil(outputUnits.get(turn.id)! / 4) }
            : {}),
          ...(["completed", "interrupted", "failed", "cancelled"].includes(turn.status)
            ? { executionCompletedAtMs: previous?.executionCompletedAtMs ?? nowMs }
            : {}),
        };
        turns.set(turn.id, timing);
        const latency =
          executionStartedMonotonicMs === undefined ||
          event.responseMetricsFirstOutputMonotonicMs === undefined
            ? undefined
            : Math.round(event.responseMetricsFirstOutputMonotonicMs - executionStartedMonotonicMs);
        return {
          ...event,
          providerTurn: {
            ...turn,
            responseTiming: timing,
            ...(turn.responseMetrics === undefined || latency === undefined || latency < 0
              ? {}
              : {
                  responseMetrics: {
                    ...turn.responseMetrics,
                    executionStartedAtMs,
                    firstOutputLatencyMs: latency,
                  },
                }),
          },
        };
      }
      if (event.type === "runtime_request.updated") {
        const request = event.runtimeRequest;
        if (
          request.providerTurnId !== null &&
          turns.has(request.providerTurnId) &&
          request.status === "pending" &&
          !startedTools.has(request.id)
        ) {
          startedTools.add(request.id);
          lastOutputAt.delete(request.providerTurnId);
        }
      }
      if (event.type !== "turn_item.updated") return event;
      const item = event.turnItem;
      if (
        item.threadId !== owner.threadId ||
        item.runId !== owner.runId ||
        item.providerThreadId !== owner.providerThreadId ||
        item.providerTurnId === null
      )
        return event;
      const timing = turns.get(item.providerTurnId);
      if (
        timing === undefined ||
        timing.executionCompletedAtMs !== undefined ||
        nowMs < timing.executionStartedAtMs
      )
        return event;
      if (item.type !== "assistant_message" && item.type !== "reasoning") {
        if (
          [
            "command_execution",
            "mcp_tool_call",
            "dynamic_tool",
            "file_change",
            "web_search",
            "approval_request",
            "user_input_request",
            "error",
          ].includes(item.type) &&
          !startedTools.has(item.id)
        ) {
          startedTools.add(item.id);
          lastOutputAt.delete(item.providerTurnId);
        }
        return event;
      }
      const previousOutput = outputStates.get(item.id);
      const previousLength = previousOutput?.length ?? 0;
      const recount = !item.streaming || item.text.length < previousLength;
      const units = recount
        ? visibleTokenUnits(item.text, 0)
        : (previousOutput?.units ?? 0) + visibleTokenUnits(item.text, previousLength);
      const hasOutput = recount
        ? item.text.trim().length > 0
        : previousOutput?.hasOutput === true || item.text.slice(previousLength).trim().length > 0;
      outputStates.set(item.id, { length: item.text.length, units, hasOutput });
      outputUnits.set(
        item.providerTurnId,
        (outputUnits.get(item.providerTurnId) ?? 0) +
          (hasOutput ? units : 0) -
          (previousOutput?.hasOutput ? previousOutput.units : 0),
      );
      const observation = item.outputObservation;
      if (
        observation !== undefined &&
        observation.firstObservedAtMs >= timing.executionStartedAtMs &&
        observation.lastObservedAtMs >= observation.firstObservedAtMs
      ) {
        const windows = rawWindows.get(item.providerTurnId) ?? new Map<string, Observation>();
        const previous = windows.get(item.id);
        windows.set(item.id, {
          firstObservedAtMs: Math.min(
            previous?.firstObservedAtMs ?? observation.firstObservedAtMs,
            observation.firstObservedAtMs,
          ),
          lastObservedAtMs: Math.max(
            previous?.lastObservedAtMs ?? observation.lastObservedAtMs,
            observation.lastObservedAtMs,
          ),
          sampleCount: Math.max(previous?.sampleCount ?? 0, observation.sampleCount),
        });
        rawWindows.set(item.providerTurnId, windows);
        turns.set(item.providerTurnId, {
          ...timing,
          firstOutputObservedAtMs: Math.min(
            timing.firstOutputObservedAtMs ?? observation.firstObservedAtMs,
            observation.firstObservedAtMs,
          ),
        });
        return event;
      }
      if (item.text.length <= previousLength || item.text.slice(previousLength).trim().length === 0)
        return event;
      const previousAt = lastOutputAt.get(item.providerTurnId);
      const streamed = item.streaming;
      if (streamed) lastOutputAt.set(item.providerTurnId, nowMs);
      // Persist with the next existing turn update, without a write or broadcast per text chunk.
      turns.set(item.providerTurnId, {
        ...timing,
        firstOutputObservedAtMs: timing.firstOutputObservedAtMs ?? nowMs,
        ...(streamed
          ? {
              observedOutputDurationMs:
                (timing.observedOutputDurationMs ?? 0) +
                (previousAt === undefined ? 0 : Math.max(0, nowMs - previousAt)),
              outputSampleCount: (timing.outputSampleCount ?? 0) + 1,
            }
          : {}),
      });
      return event;
    },
  };
}
