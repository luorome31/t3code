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

export function makeResponseTimingCollector(owner: {
  threadId: ThreadId;
  runId: RunId;
  attemptId: RunAttemptId;
  providerThreadId: ProviderThreadId;
}) {
  let executionStartedAtMs: number | undefined;
  const turns = new Map<ProviderTurnId, Timing>();
  const lastOutputAt = new Map<ProviderTurnId, number>();
  const outputLengths = new Map<string, number>();
  const startedTools = new Set<string>();
  const rawWindows = new Map<ProviderTurnId, Map<string, Observation>>();
  return {
    start(nowMs: number) {
      executionStartedAtMs ??= nowMs;
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
          ...(["completed", "interrupted", "failed", "cancelled"].includes(turn.status)
            ? { executionCompletedAtMs: previous?.executionCompletedAtMs ?? nowMs }
            : {}),
        };
        turns.set(turn.id, timing);
        return { ...event, providerTurn: { ...turn, responseTiming: timing } };
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
      const previousLength = outputLengths.get(item.id) ?? 0;
      outputLengths.set(item.id, Math.max(previousLength, item.text.length));
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
