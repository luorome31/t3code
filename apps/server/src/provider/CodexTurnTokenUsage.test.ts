import { describe, expect, it } from "vite-plus/test";
import {
  accumulateCodexTurnTokenUsage,
  completeCodexTurnTokenUsage,
  getCodexTurnAccumulator,
  makeCodexTurnTokenUsageState,
} from "./CodexTurnTokenUsage.ts";

function usage(outputTokens: number) {
  const value = {
    inputTokens: outputTokens * 2,
    outputTokens,
    totalTokens: outputTokens * 3,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
  };
  return { total: value, last: value, modelContextWindow: null };
}

describe("Codex turn usage", () => {
  it("completes late cumulative usage for the finished turn once without counting a duplicate", () => {
    const state = makeCodexTurnTokenUsageState();
    state.activeTurnId = "old";
    getCodexTurnAccumulator(state, "old").models.add("earlier-reported-model");
    accumulateCodexTurnTokenUsage(state, "old", usage(100));
    expect(completeCodexTurnTokenUsage(state, "old", true, "recorded-model")).toMatchObject({
      outputTokens: 100,
      usageStatus: "complete",
    });
    expect(accumulateCodexTurnTokenUsage(state, "old", usage(150))).toMatchObject({
      outputTokens: 150,
      usageStatus: "complete",
      models: ["earlier-reported-model", "recorded-model"],
    });
    expect(accumulateCodexTurnTokenUsage(state, "old", usage(150))).toBeUndefined();
    expect(accumulateCodexTurnTokenUsage(state, "old", usage(120))).toBeUndefined();
  });
  it("does not charge an old turn's late tokens to a newer turn", () => {
    const state = makeCodexTurnTokenUsageState();
    state.activeTurnId = "old";
    accumulateCodexTurnTokenUsage(state, "old", usage(100));
    completeCodexTurnTokenUsage(state, "old", true);
    state.activeTurnId = "new";
    expect(accumulateCodexTurnTokenUsage(state, "old", usage(120))).toBeUndefined();
    accumulateCodexTurnTokenUsage(state, "new", usage(130));
    expect(completeCodexTurnTokenUsage(state, "new", true)).toMatchObject({ outputTokens: 10 });
  });
  it("can fill initially unavailable usage after success while keeping failed usage partial", () => {
    const state = makeCodexTurnTokenUsageState();
    state.activeTurnId = "turn";
    expect(completeCodexTurnTokenUsage(state, "turn", true).usageStatus).toBe("unavailable");
    expect(accumulateCodexTurnTokenUsage(state, "turn", usage(10))).toMatchObject({
      outputTokens: 10,
      usageStatus: "complete",
    });
    state.activeTurnId = "failed";
    completeCodexTurnTokenUsage(state, "failed", false);
    expect(accumulateCodexTurnTokenUsage(state, "failed", usage(20))).toMatchObject({
      outputTokens: 10,
      usageStatus: "partial",
    });
  });
});
