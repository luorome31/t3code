import { describe, expect, it } from "vite-plus/test";
import {
  NodeId,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  MessageId,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { deriveResponseMetrics } from "./responseMetrics.ts";

function setup() {
  const run: OrchestrationV2Run = {
    id: RunId.make("run"),
    threadId: ThreadId.make("thread"),
    ordinal: 1,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "requested",
      options: [{ id: "reasoning_effort", value: "high" }],
    },
    providerThreadId: ProviderThreadId.make("main"),
    userMessageId: MessageId.make("user"),
    rootNodeId: NodeId.make("root"),
    activeAttemptId: RunAttemptId.make("attempt"),
    status: "completed",
    requestedAt: DateTime.makeUnsafe(0),
    startedAt: DateTime.makeUnsafe(100),
    completedAt: DateTime.makeUnsafe(50_000),
    checkpointId: null,
    contextHandoffId: null,
  };
  const attempt = {
    id: run.activeAttemptId!,
    runId: run.id,
    attemptOrdinal: 1,
    rootNodeId: run.rootNodeId!,
    providerInstanceId: run.providerInstanceId,
    providerThreadId: run.providerThreadId!,
    providerTurnId: ProviderTurnId.make("one"),
    reason: "initial" as const,
    status: "completed" as const,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
  const turn: OrchestrationV2ProviderTurn = {
    id: ProviderTurnId.make("one"),
    providerThreadId: run.providerThreadId!,
    nodeId: run.rootNodeId!,
    runAttemptId: attempt.id,
    nativeTurnRef: null,
    ordinal: 1,
    status: "completed",
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    turnTokenUsage: {
      usageScope: "main_agent",
      usageStatus: "complete",
      hasSubagents: false,
      inputTokens: 200,
      outputTokens: 100,
      reasoningTokens: 30,
      models: ["reported-one"],
    },
    responseMetrics: {
      version: 2,
      kind: "visible_stream",
      tokenScope: "visible_text",
      tokenSource: "text_estimate",
      timingSource: "server_monotonic",
      tokenCount: 60,
      durationMs: 1000,
      sampleCount: 10,
      maxGapMs: 200,
      longGapCount: 0,
      excludedInitialTokens: 2,
      tokensPerSecond: 60,
      firstOutputObservedAtMs: 400,
    },
    responseTiming: {
      version: 1,
      executionStartedAtMs: 100,
      firstOutputObservedAtMs: 400,
      executionCompletedAtMs: 50_000,
      observedOutputDurationMs: 1000,
      outputSampleCount: 3,
    },
  };
  return { run, attempt, turn };
}

describe("response metrics", () => {
  it("aggregates every main-agent generation window with weighted TPS, without adding reasoning twice or using wall time", () => {
    const { run, attempt, turn } = setup();
    const second: OrchestrationV2ProviderTurn = {
      ...turn,
      id: ProviderTurnId.make("two"),
      ordinal: 2,
      turnTokenUsage: {
        ...turn.turnTokenUsage!,
        usageStatus: "complete",
        usageScope: "main_agent",
        inputTokens: 1,
        outputTokens: 900,
        models: ["reported-two"],
      },
      responseMetrics: {
        ...turn.responseMetrics!,
        tokenCount: 300,
        durationMs: 3000,
        tokensPerSecond: 100,
      },
      responseTiming: {
        ...turn.responseTiming!,
        executionStartedAtMs: 25_000,
        firstOutputObservedAtMs: 26_000,
        observedOutputDurationMs: 3000,
      },
    };
    const child = { ...turn, id: ProviderTurnId.make("child"), runAttemptId: null };
    const result = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [turn, second, child, turn],
    }).get(run.id)!;
    expect(result).toMatchObject({
      outputTokens: 1000,
      observedOutputDurationMs: 4000,
      estimatedTps: 90,
      throughput: { tokenCount: 360, durationMs: 4000 },
      firstOutputLatencyMs: 300,
      partial: false,
    });
    expect(result.reportedModels).toEqual(["reported-one", "reported-two"]);
    expect(result.requested).toEqual([run.modelSelection]);
    const clockAdjusted = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [
        {
          ...turn,
          responseMetrics: {
            ...turn.responseMetrics!,
            executionStartedAtMs: 100,
            firstOutputObservedAtMs: 40_000,
            firstOutputLatencyMs: 300,
          },
        },
      ],
    }).get(run.id)!;
    expect(clockAdjusted.firstOutputLatencyMs).toBe(300);
  });

  it("keeps partial output, completes late usage on its own run, and preserves first output", () => {
    const { run, attempt, turn } = setup();
    const second = { ...turn, id: ProviderTurnId.make("two"), turnTokenUsage: undefined };
    const pending = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [turn, second],
    }).get(run.id)!;
    expect(pending).toMatchObject({ outputTokens: 100, partial: true, firstOutputLatencyMs: 300 });
    expect(pending.estimatedTps).toBe(60);
    const complete = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [turn, { ...second, turnTokenUsage: turn.turnTokenUsage }],
    }).get(run.id)!;
    expect(complete).toMatchObject({
      outputTokens: 200,
      partial: false,
      firstOutputLatencyMs: 300,
      estimatedTps: 60,
    });
    const failed = deriveResponseMetrics({
      runs: [{ ...run, status: "failed" }],
      attempts: [attempt],
      providerTurns: [turn],
    }).get(run.id)!;
    expect(failed).toMatchObject({ outputTokens: 100, partial: true, firstOutputLatencyMs: 300 });
    expect(failed.estimatedTps).toBeUndefined();
  });

  it("does not fabricate historical timing, buffered-stream TPS, missing usage or running statistics", () => {
    const { run, attempt, turn } = setup();
    const old = {
      ...turn,
      responseTiming: undefined,
      responseMetrics: undefined,
      turnTokenUsage: undefined,
    };
    const result = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [old],
    }).get(run.id)!;
    expect(result.firstOutputLatencyMs).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
    expect(result.estimatedTps).toBeUndefined();
    expect(result.missing.length).toBeGreaterThan(0);
    const hiddenReasoning = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [
        {
          ...turn,
          responseMetrics: undefined,
          turnTokenUsage: { ...turn.turnTokenUsage!, outputTokens: 12_003, reasoningTokens: 6_239 },
          responseTiming: {
            ...turn.responseTiming!,
            observedOutputDurationMs: 14_701,
            outputSampleCount: 1162,
          },
        },
      ],
    }).get(run.id)!;
    expect(hiddenReasoning.outputTokens).toBe(12_003);
    expect(hiddenReasoning.estimatedTps).toBeUndefined();
    const buffered = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [
        {
          ...turn,
          responseMetrics: undefined,
          responseTiming: { version: 1, executionStartedAtMs: 100, firstOutputObservedAtMs: 400 },
        },
      ],
    }).get(run.id)!;
    expect(buffered.outputTokens).toBe(100);
    expect(buffered.estimatedTps).toBeUndefined();
    expect(
      deriveResponseMetrics({
        runs: [{ ...run, status: "running" }],
        attempts: [attempt],
        providerTurns: [turn],
      }).size,
    ).toBe(0);
  });
  it("keeps visible speed independent of late reported totals, partial usage and missing usage", () => {
    const { run, attempt, turn } = setup();
    const fallback = {
      ...turn,
      turnTokenUsage: undefined,
      responseTiming: { ...turn.responseTiming!, estimatedVisibleOutputTokens: 60 },
    };
    const derive = (
      providerTurns: ReadonlyArray<OrchestrationV2ProviderTurn>,
      status = run.status,
    ) =>
      deriveResponseMetrics({ runs: [{ ...run, status }], attempts: [attempt], providerTurns }).get(
        run.id,
      )!;
    expect(derive([fallback])).toMatchObject({
      outputTokens: 60,
      outputTokensEstimated: true,
      estimatedTps: 60,
      partial: false,
    });
    expect(derive([{ ...fallback, turnTokenUsage: turn.turnTokenUsage }])).toMatchObject({
      outputTokens: 100,
      outputTokensEstimated: false,
      estimatedTps: 60,
    });
    expect(derive([fallback, { ...turn, id: ProviderTurnId.make("two") }])).toMatchObject({
      outputTokens: 160,
      outputTokensEstimated: true,
      estimatedTps: 60,
    });
    expect(
      derive([
        { ...fallback, turnTokenUsage: { ...turn.turnTokenUsage!, usageStatus: "partial" } },
      ]),
    ).toMatchObject({ outputTokens: 100, partial: true, estimatedTps: 60 });
    const unavailable = {
      ...turn.responseMetrics!,
      tokensPerSecond: undefined,
      unavailableReason: "buffered_output" as const,
    };
    expect(derive([{ ...fallback, responseMetrics: unavailable }]).estimatedTps).toBeUndefined();
    expect(
      derive([{ ...fallback, turnTokenUsage: { ...turn.turnTokenUsage!, localCommand: true } }])
        .outputTokens,
    ).toBeUndefined();
    expect(derive([fallback], "failed").estimatedTps).toBeUndefined();
  });
});
