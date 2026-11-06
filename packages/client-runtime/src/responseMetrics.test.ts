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
      estimatedTps: 250,
      firstOutputLatencyMs: 300,
      partial: false,
    });
    expect(result.reportedModels).toEqual(["reported-one", "reported-two"]);
    expect(result.requested).toEqual([run.modelSelection]);
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
    expect(pending.estimatedTps).toBeUndefined();
    const complete = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [turn, { ...second, turnTokenUsage: turn.turnTokenUsage }],
    }).get(run.id)!;
    expect(complete).toMatchObject({
      outputTokens: 200,
      partial: false,
      firstOutputLatencyMs: 300,
      estimatedTps: 100,
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
    const old = { ...turn, responseTiming: undefined, turnTokenUsage: undefined };
    const result = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [old],
    }).get(run.id)!;
    expect(result.firstOutputLatencyMs).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
    expect(result.estimatedTps).toBeUndefined();
    expect(result.missing.length).toBeGreaterThan(0);
    const buffered = deriveResponseMetrics({
      runs: [run],
      attempts: [attempt],
      providerTurns: [
        {
          ...turn,
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
});
