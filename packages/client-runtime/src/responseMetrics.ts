import type {
  ModelSelection,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export interface ResponseMetrics {
  readonly runId: RunId;
  readonly completedAtMs: number;
  readonly provider: string;
  readonly requested: ReadonlyArray<ModelSelection>;
  readonly reportedModels: ReadonlyArray<string>;
  readonly executionStartedAtMs?: number;
  readonly firstOutputObservedAtMs?: number;
  readonly firstOutputLatencyMs?: number;
  readonly observedOutputDurationMs?: number;
  readonly outputTokens?: number;
  readonly outputTokensEstimated: boolean;
  readonly partial: boolean;
  readonly estimatedTps?: number;
  readonly missing: ReadonlyArray<string>;
}

export function deriveResponseMetrics(input: {
  runs: ReadonlyArray<OrchestrationV2Run>;
  attempts: ReadonlyArray<OrchestrationV2RunAttempt>;
  providerTurns: ReadonlyArray<OrchestrationV2ProviderTurn>;
}): ReadonlyMap<RunId, ResponseMetrics> {
  const runByAttempt = new Map(input.attempts.map((attempt) => [attempt.id, attempt.runId]));
  const attemptsByRun = new Map<RunId, OrchestrationV2RunAttempt[]>();
  for (const attempt of input.attempts) {
    const attempts = attemptsByRun.get(attempt.runId) ?? [];
    attempts.push(attempt);
    attemptsByRun.set(attempt.runId, attempts);
  }
  const byRun = new Map<RunId, OrchestrationV2ProviderTurn[]>();
  for (const turn of new Map(input.providerTurns.map((turn) => [turn.id, turn])).values()) {
    const runId = turn.runAttemptId === null ? undefined : runByAttempt.get(turn.runAttemptId);
    if (runId === undefined) continue;
    const turns = byRun.get(runId) ?? [];
    turns.push(turn);
    byRun.set(runId, turns);
  }
  const result = new Map<RunId, ResponseMetrics>();
  for (const run of input.runs) {
    if (!["completed", "failed", "cancelled", "interrupted"].includes(run.status)) continue;
    const turns = byRun.get(run.id) ?? [];
    const timings = turns.flatMap((turn) => (turn.responseTiming ? [turn.responseTiming] : []));
    const timed = turns.length > 0 && timings.length === turns.length;
    const starts = timings.map((timing) => timing.executionStartedAtMs);
    const outputs = timings.flatMap((timing) =>
      timing.firstOutputObservedAtMs === undefined ? [] : [timing.firstOutputObservedAtMs],
    );
    const executionStartedAtMs = timed ? Math.min(...starts) : undefined;
    const firstOutputObservedAtMs = timed && outputs.length > 0 ? Math.min(...outputs) : undefined;
    const latency =
      executionStartedAtMs === undefined || firstOutputObservedAtMs === undefined
        ? undefined
        : firstOutputObservedAtMs - executionStartedAtMs;
    const duration =
      timed &&
      timings.every(
        (timing) =>
          (timing.observedOutputDurationMs ?? 0) > 0 && (timing.outputSampleCount ?? 0) > 1,
      )
        ? timings.reduce((total, timing) => total + timing.observedOutputDurationMs!, 0)
        : undefined;
    const usages = turns.flatMap((turn) =>
      turn.turnTokenUsage && !turn.turnTokenUsage.localCommand ? [turn.turnTokenUsage] : [],
    );
    const samples = turns.map((turn) => {
      const usage = turn.turnTokenUsage;
      if (usage?.localCommand) return { tokens: undefined, estimated: false, complete: false };
      if (usage?.outputTokens !== undefined)
        return {
          tokens: usage.outputTokens,
          estimated: false,
          complete: usage.usageStatus === "complete",
        };
      const tokens = turn.responseTiming?.estimatedVisibleOutputTokens;
      return {
        tokens,
        estimated: tokens !== undefined,
        complete: tokens !== undefined && turn.status === "completed",
      };
    });
    const known = samples.flatMap((sample) => (sample.tokens === undefined ? [] : [sample.tokens]));
    const outputTokensEstimated = samples.some((sample) => sample.estimated);
    const sum = known.reduce((total, tokens) => total + tokens, 0);
    const outputTokens =
      known.length > 0 && Number.isSafeInteger(sum) && sum >= 0 ? sum : undefined;
    const attempts = attemptsByRun.get(run.id) ?? [];
    const complete =
      run.status === "completed" &&
      turns.length > 0 &&
      samples.every((sample) => sample.complete) &&
      attempts.every((attempt) => turns.some((turn) => turn.runAttemptId === attempt.id));
    const observedOutputDurationMs =
      duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : undefined;
    const firstOutputLatencyMs =
      latency !== undefined && Number.isFinite(latency) && latency >= 0 ? latency : undefined;
    const tps =
      complete && outputTokens !== undefined && observedOutputDurationMs !== undefined
        ? (outputTokens * 1000) / observedOutputDurationMs
        : undefined;
    const estimatedTps = tps !== undefined && Number.isFinite(tps) ? tps : undefined;
    const missing = [];
    if (firstOutputLatencyMs === undefined)
      missing.push("First output was not recorded for this run.");
    if (outputTokens === undefined)
      missing.push("The provider did not report main-agent output tokens.");
    else if (!complete)
      missing.push(
        "Output tokens are partial; some execution segments are missing or the run did not complete successfully.",
      );
    if (estimatedTps === undefined)
      missing.push(
        observedOutputDurationMs === undefined
          ? "Streaming output windows were not recorded for every provider turn."
          : "Estimated TPS requires a successful run with output coverage for every execution segment.",
      );
    result.set(run.id, {
      runId: run.id,
      completedAtMs: DateTime.toEpochMillis(run.completedAt ?? run.requestedAt),
      provider: run.providerInstanceId,
      requested: [run.modelSelection],
      reportedModels: [...new Set(usages.flatMap((usage) => usage.models ?? []))],
      ...(executionStartedAtMs === undefined ? {} : { executionStartedAtMs }),
      ...(firstOutputObservedAtMs === undefined ? {} : { firstOutputObservedAtMs }),
      ...(firstOutputLatencyMs === undefined ? {} : { firstOutputLatencyMs }),
      ...(observedOutputDurationMs === undefined ? {} : { observedOutputDurationMs }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      outputTokensEstimated,
      ...(estimatedTps === undefined ? {} : { estimatedTps }),
      partial: !complete,
      missing,
    });
  }
  return result;
}
