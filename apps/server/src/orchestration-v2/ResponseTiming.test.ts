import { describe, expect, it } from "vite-plus/test";
import {
  MessageId,
  NodeId,
  ProviderDriverKind,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type { ProviderAdapterV2Event } from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import { makeResponseTimingCollector } from "./ResponseTiming.ts";

function setup(driverName = "codex") {
  const owner = {
    threadId: ThreadId.make("thread"),
    runId: RunId.make("run"),
    attemptId: RunAttemptId.make("attempt"),
    providerThreadId: ProviderThreadId.make("main"),
  };
  const driver = ProviderDriverKind.make(driverName);
  const collector = makeResponseTimingCollector(owner);
  const turn = {
    id: ProviderTurnId.make("turn"),
    providerThreadId: owner.providerThreadId,
    nodeId: NodeId.make("node"),
    runAttemptId: owner.attemptId,
    nativeTurnRef: null,
    ordinal: 1,
    status: "running" as const,
    startedAt: DateTime.makeUnsafe(100),
    completedAt: null,
  };
  const turnEvent = { type: "provider_turn.updated" as const, driver, providerTurn: turn };
  const text = (value: string, type: "assistant_message" | "reasoning" = "assistant_message") => ({
    type: "turn_item.updated" as const,
    driver,
    turnItem: {
      id: TurnItemId.make(type),
      threadId: owner.threadId,
      runId: owner.runId,
      nodeId: turn.nodeId,
      providerThreadId: owner.providerThreadId,
      providerTurnId: turn.id,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "running" as const,
      title: null,
      startedAt: DateTime.makeUnsafe(100),
      completedAt: null,
      updatedAt: DateTime.makeUnsafe(100),
      ...(type === "assistant_message"
        ? { type: "assistant_message" as const, messageId: MessageId.make("message") }
        : { type: "reasoning" as const }),
      text: value,
      streaming: true,
    },
  });
  const finish = (nowMs: number) => {
    const result = collector.observe(
      {
        ...turnEvent,
        providerTurn: {
          ...turn,
          status: "completed",
          completedAt: DateTime.makeUnsafe(nowMs),
        },
      },
      nowMs,
    );
    if (result.type !== "provider_turn.updated") throw new Error("Expected turn update");
    return result.providerTurn.responseTiming;
  };
  return { owner, collector, turnEvent, text, finish };
}

describe("response timing", () => {
  it.each(["codex", "opencode", "antigravity", "qoder-cn"])(
    "observes first main-agent output for %s without changing output events",
    (driver) => {
      const h = setup(driver);
      const beforeStart = h.text("history");
      expect(h.collector.observe(beforeStart, 50)).toBe(beforeStart);
      h.collector.start(100);
      h.collector.observe(h.turnEvent, 110);
      h.collector.observe(h.text("  ", "reasoning"), 120);
      const inherited = h.text("inherited");
      h.collector.observe({ ...inherited, turnItem: { ...inherited.turnItem, runId: null } }, 130);
      h.collector.observe(
        {
          ...inherited,
          turnItem: { ...inherited.turnItem, providerThreadId: ProviderThreadId.make("child") },
        },
        140,
      );
      const reasoning = h.text("thinking", "reasoning");
      expect(h.collector.observe(reasoning, 150)).toBe(reasoning);
      h.collector.observe(h.text("answer"), 200);
      expect(h.finish(300)).toMatchObject({
        executionStartedAtMs: 100,
        firstOutputObservedAtMs: 150,
      });
      h.collector.observe(h.text("late answer"), 400);
      expect(h.finish(500)?.firstOutputObservedAtMs).toBe(150);
    },
  );

  it("splits streaming windows at tools while retaining concurrent output and excluding duplicate terminal text", () => {
    const h = setup();
    h.collector.start(100);
    h.collector.observe(h.turnEvent, 100);
    h.collector.observe(h.text("a"), 200);
    h.collector.observe(h.text("ab"), 300);
    const base = h.text("").turnItem;
    const tool: ProviderAdapterV2Event = {
      type: "turn_item.updated",
      driver: h.turnEvent.driver,
      turnItem: {
        ...base,
        id: TurnItemId.make("tool"),
        type: "command_execution",
        input: "command",
      },
    };
    h.collector.observe(tool, 400);
    h.collector.observe(h.text("abc"), 10_000);
    h.collector.observe(h.text("abcd"), 10_100);
    h.collector.observe(tool, 10_150);
    h.collector.observe(h.text("abcde"), 10_200);
    const final = h.text("abcde");
    h.collector.observe(
      { ...final, turnItem: { ...final.turnItem, streaming: false, status: "completed" } },
      20_000,
    );
    expect(h.finish(20_100)).toMatchObject({
      firstOutputObservedAtMs: 200,
      executionCompletedAtMs: 20_100,
      observedOutputDurationMs: 300,
      outputSampleCount: 5,
    });
  });

  it("captures non-streamed first output without inventing a streaming duration", () => {
    const h = setup();
    h.collector.start(100);
    h.collector.observe(h.turnEvent, 100);
    const text = h.text("complete response");
    h.collector.observe({ ...text, turnItem: { ...text.turnItem, streaming: false } }, 1000);
    expect(h.finish(1100)).toEqual({
      version: 1,
      executionStartedAtMs: 100,
      firstOutputObservedAtMs: 1000,
      executionCompletedAtMs: 1100,
    });
  });
  it("uses pre-coalescing observations and merges overlapping output windows without counting replay twice", () => {
    const h = setup();
    h.collector.start(100);
    h.collector.observe(h.turnEvent, 100);
    const message = h.text("buffered answer");
    const reasoning = h.text("buffered thought", "reasoning");
    const observed = {
      ...message,
      turnItem: {
        ...message.turnItem,
        streaming: false,
        outputObservation: { firstObservedAtMs: 200, lastObservedAtMs: 400, sampleCount: 3 },
      },
    };
    h.collector.observe(observed, 1000);
    h.collector.observe(observed, 1100);
    h.collector.observe(
      {
        ...reasoning,
        turnItem: {
          ...reasoning.turnItem,
          streaming: false,
          outputObservation: { firstObservedAtMs: 300, lastObservedAtMs: 500, sampleCount: 2 },
        },
      },
      1200,
    );
    expect(h.finish(2000)).toMatchObject({
      firstOutputObservedAtMs: 200,
      observedOutputDurationMs: 300,
      outputSampleCount: 5,
    });
  });
});
