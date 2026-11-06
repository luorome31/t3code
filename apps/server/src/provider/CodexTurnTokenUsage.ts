import type { TurnTokenUsage } from "@t3tools/contracts";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

type CodexCumulativeTokenUsage = {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens?: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
};

interface CodexTurnTokenUsageAccumulator {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number | undefined;
  outputTokens: number;
  reasoningTokens: number;
  observed: boolean;
  hasSubagents: boolean;
  readonly models: Set<string>;
}

export interface CodexTurnTokenUsageState {
  baseline: CodexCumulativeTokenUsage | undefined;
  activeTurnId: string | undefined;
  readonly byTurnId: Map<string, CodexTurnTokenUsageAccumulator>;
  completedTurn:
    | {
        id: string;
        usage: CodexTurnTokenUsageAccumulator;
        completed: boolean;
      }
    | undefined;
}

function codexTokenUsageBreakdown(
  usage: EffectCodexSchema.V2ThreadTokenUsageUpdatedNotification__TokenUsageBreakdown,
): CodexCumulativeTokenUsage {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    ...(usage.cacheWriteInputTokens !== undefined
      ? { cacheCreationTokens: usage.cacheWriteInputTokens }
      : {}),
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningOutputTokens,
  };
}

export function makeCodexTurnTokenUsageState(): CodexTurnTokenUsageState {
  return {
    baseline: undefined,
    activeTurnId: undefined,
    byTurnId: new Map(),
    completedTurn: undefined,
  };
}

export function getCodexTurnAccumulator(
  state: CodexTurnTokenUsageState,
  turnId: string,
): CodexTurnTokenUsageAccumulator {
  const existing = state.byTurnId.get(turnId);
  if (existing) return existing;
  const created: CodexTurnTokenUsageAccumulator = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    observed: false,
    hasSubagents: false,
    models: new Set(),
  };
  state.byTurnId.set(turnId, created);
  return created;
}

/** total is thread-wide; last covers the newest model response. */
function codexTurnTokenUsageDelta(
  previous: CodexCumulativeTokenUsage | undefined,
  current: CodexCumulativeTokenUsage,
  last: CodexCumulativeTokenUsage,
): CodexCumulativeTokenUsage {
  if (
    previous === undefined ||
    current.inputTokens < previous.inputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    current.outputTokens < previous.outputTokens ||
    current.reasoningTokens < previous.reasoningTokens
  ) {
    return last;
  }
  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    ...(current.cacheCreationTokens !== undefined &&
    previous.cacheCreationTokens !== undefined &&
    current.cacheCreationTokens >= previous.cacheCreationTokens
      ? { cacheCreationTokens: current.cacheCreationTokens - previous.cacheCreationTokens }
      : {}),
    outputTokens: current.outputTokens - previous.outputTokens,
    reasoningTokens: current.reasoningTokens - previous.reasoningTokens,
  };
}

export function accumulateCodexTurnTokenUsage(
  state: CodexTurnTokenUsageState,
  turnId: string,
  usage: EffectCodexSchema.V2ThreadTokenUsageUpdatedNotification["tokenUsage"],
): TurnTokenUsage | undefined {
  const current = codexTokenUsageBreakdown(usage.total);
  const completed =
    state.activeTurnId === undefined && state.completedTurn?.id === turnId
      ? state.completedTurn
      : undefined;
  const backwards =
    state.baseline !== undefined &&
    (current.inputTokens < state.baseline.inputTokens ||
      current.cachedInputTokens < state.baseline.cachedInputTokens ||
      current.outputTokens < state.baseline.outputTokens ||
      current.reasoningTokens < state.baseline.reasoningTokens);
  if (state.activeTurnId !== turnId && completed === undefined) {
    // Monotonic totals from other turns advance the baseline without charging their tokens here.
    if (!backwards) state.baseline = current;
    return;
  }
  if (completed !== undefined && backwards) return;
  const accumulator = completed?.usage ?? getCodexTurnAccumulator(state, turnId);
  const delta = codexTurnTokenUsageDelta(
    state.baseline,
    current,
    codexTokenUsageBreakdown(usage.last),
  );
  state.baseline = current;

  if (
    delta.inputTokens > 0 ||
    delta.cachedInputTokens > 0 ||
    delta.outputTokens > 0 ||
    delta.reasoningTokens > 0
  ) {
    accumulator.observed = true;
  }
  accumulator.inputTokens += delta.inputTokens;
  accumulator.cachedInputTokens += delta.cachedInputTokens;
  accumulator.outputTokens += delta.outputTokens;
  accumulator.reasoningTokens += delta.reasoningTokens;
  if (delta.cacheCreationTokens === undefined) {
    accumulator.cacheCreationTokens = undefined;
  } else if (accumulator.cacheCreationTokens !== undefined) {
    accumulator.cacheCreationTokens += delta.cacheCreationTokens;
  }
  return completed !== undefined &&
    (delta.inputTokens > 0 ||
      delta.outputTokens > 0 ||
      delta.cachedInputTokens > 0 ||
      delta.reasoningTokens > 0)
    ? codexUsageSnapshot(accumulator, completed.completed)
    : undefined;
}

/** `model` is the thread model Codex last reported, which a reroute replaces. */
export function completeCodexTurnTokenUsage(
  state: CodexTurnTokenUsageState,
  turnId: string,
  completed: boolean,
  model?: string,
): TurnTokenUsage {
  const usage = getCodexTurnAccumulator(state, turnId);
  if (model !== undefined) usage.models.add(model);
  state.byTurnId.delete(turnId);
  if (state.activeTurnId === turnId) state.activeTurnId = undefined;
  state.completedTurn = { id: turnId, usage, completed };
  return codexUsageSnapshot(usage, completed);
}

function codexUsageSnapshot(
  usage: CodexTurnTokenUsageAccumulator,
  completed: boolean,
): TurnTokenUsage {
  const models = usage.models.size > 0 ? { models: [...usage.models] } : {};
  if (!usage.observed) {
    return {
      usageStatus: "unavailable",
      usageScope: "main_agent",
      hasSubagents: usage.hasSubagents,
      ...models,
    };
  }

  // Codex counts cache reads and writes inside inputTokens.
  return {
    usageStatus: completed ? "complete" : "partial",
    usageScope: "main_agent",
    inputTokens: usage.inputTokens,
    cachedInputTokens: Math.min(usage.inputTokens, usage.cachedInputTokens),
    ...(usage.cacheCreationTokens !== undefined
      ? { cacheCreationTokens: Math.min(usage.inputTokens, usage.cacheCreationTokens) }
      : {}),
    outputTokens: usage.outputTokens,
    reasoningTokens: Math.min(usage.outputTokens, usage.reasoningTokens),
    hasSubagents: usage.hasSubagents,
    ...models,
  };
}
