import { describe, expect, it } from "vite-plus/test";
import {
  NodeId,
  ProviderDriverKind,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
} from "@t3tools/contracts";
import { makeProviderResponseMetrics } from "./responseMetrics.ts";

function setup() {
  let mono = 0;
  let epoch = 1000;
  const collector = makeProviderResponseMetrics({
    monotonicTimeNanosUnsafe: () => BigInt(Math.round(mono * 1_000_000)),
    currentTimeMillisUnsafe: () => epoch,
  });
  const event = {
    type: "provider_turn.updated" as const,
    driver: ProviderDriverKind.make("codex"),
    providerTurn: {
      id: ProviderTurnId.make("turn"),
      providerThreadId: ProviderThreadId.make("main"),
      nodeId: NodeId.make("node"),
      runAttemptId: RunAttemptId.make("attempt"),
      nativeTurnRef: null,
      ordinal: 1,
      status: "running" as const,
      startedAt: null,
      completedAt: null,
    },
  };
  collector.observe(event);
  const append = (at: number, text = "abcd", key = "body") => {
    mono = at;
    collector.append(event.providerTurn.id, key, text);
  };
  const finish = (status: "completed" | "cancelled" = "completed") => {
    const result = collector.observe({ ...event, providerTurn: { ...event.providerTurn, status } });
    if (result.type !== "provider_turn.updated") throw new Error("Expected provider turn");
    return result.providerTurn.responseMetrics!;
  };
  return {
    collector,
    event,
    append,
    finish,
    setEpoch: (value: number) => {
      epoch = value;
    },
  };
}

describe("raw visible response metrics", () => {
  it("excludes the first packet, never uses reported hidden tokens, and survives wall-clock jumps", () => {
    const h = setup();
    h.append(0, "x".repeat(4000));
    h.setEpoch(1);
    for (const at of [100, 200, 300, 400]) h.append(at);
    const result = h.finish();
    expect(result).toMatchObject({
      version: 2,
      kind: "visible_stream",
      tokenScope: "visible_text",
      tokenSource: "text_estimate",
      tokenCount: 4,
      excludedInitialTokens: 1000,
      durationMs: 400,
      sampleCount: 5,
      tokensPerSecond: 10,
      firstOutputObservedAtMs: 1000,
    });
    expect(result.unavailableReason).toBeUndefined();
    expect(
      h.collector.observe({
        ...h.event,
        providerTurn: { ...h.event.providerTurn, status: "completed" },
      }).type,
    ).toBe("provider_turn.updated");
  });

  it("splits the same item across a tool boundary, retains concurrent output, and unions overlapping channels", () => {
    const h = setup();
    h.append(0);
    h.append(100);
    h.collector.boundary(h.event.providerTurn.id);
    for (const at of [10_000, 10_100, 10_200, 10_300]) h.append(at);
    expect(h.finish()).toMatchObject({
      tokenCount: 4,
      durationMs: 400,
      tokensPerSecond: 10,
      longGapCount: 0,
    });
    const overlap = setup();
    overlap.append(0);
    overlap.append(50, "abcd", "reasoning");
    overlap.append(100);
    overlap.append(150, "abcd", "reasoning");
    overlap.append(200);
    overlap.append(250, "abcd", "reasoning");
    overlap.append(300);
    expect(overlap.finish()).toMatchObject({ tokenCount: 5, durationMs: 300, sampleCount: 7 });
  });

  it.each([
    { times: [0], delta: "abcd", reason: "insufficient_samples" },
    { times: [0, 100, 200, 300, 400], delta: "a", reason: "insufficient_samples" },
    { times: [0, 0, 0, 0, 0], delta: "abcd", reason: "buffered_output" },
    { times: [0, 10, 20, 30, 40], delta: "abcd", reason: "short_window" },
    { times: [0, 100, 200, 150, 400], delta: "abcd", reason: "clock_discontinuity" },
  ])("rejects unreliable observations: $reason ($times)", ({ times, delta, reason }) => {
    const h = setup();
    for (const at of times) h.append(at, delta);
    expect(h.finish()).toMatchObject({ unavailableReason: reason });
  });

  it("retains long gaps, validates final text, counts split unicode once, and ignores other turns", () => {
    const h = setup();
    h.append(0, "\ud83d");
    h.append(100, "\ude00");
    h.append(200, "中");
    h.append(5200, "文");
    h.append(5300, "本");
    h.collector.append(ProviderTurnId.make("child"), "body", "ignored");
    h.collector.finishText(h.event.providerTurn.id, "body", "😀中文本");
    expect(h.finish()).toMatchObject({
      tokenCount: 3,
      excludedInitialTokens: 1,
      durationMs: 5300,
      maxGapMs: 5000,
      longGapCount: 1,
    });
    const corrected = setup();
    for (const at of [0, 100, 200, 300, 400]) corrected.append(at);
    corrected.collector.finishText(corrected.event.providerTurn.id, "body", "different final text");
    expect(corrected.finish()).toMatchObject({ unavailableReason: "snapshot_changed" });
    const cancelled = setup();
    for (const at of [0, 100, 200, 300, 400]) cancelled.append(at);
    expect(cancelled.finish("cancelled")).toMatchObject({ unavailableReason: "incomplete_turn" });
    expect(setup().finish()).toMatchObject({ unavailableReason: "unsupported_provider" });
  });
});
