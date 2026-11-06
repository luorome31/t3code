import type { ProviderReplayTranscript } from "@t3tools/contracts";
import { assert } from "@effect/vitest";

import type { OrchestratorV2ScenarioResult } from "../../OrchestratorScenario.ts";
import {
  assertAssistantTextIncludes,
  assertBaseProjection,
  assertConversationMessageRoles,
  assertExecutionNodeKinds,
  assertRunOrdinals,
  assertSemanticProjectionIntegrity,
  assertTurnItemTypes,
  assertUserMessagesInclude,
  assertVisibleTurnItemsMirrorLocalTurnItems,
  projectionFor,
  SIMPLE_PROMPT,
} from "../shared.ts";

export function assertSimpleOutput(
  result: OrchestratorV2ScenarioResult,
  transcript: ProviderReplayTranscript,
) {
  assertBaseProjection({ result, transcript, runCount: 1, runStatuses: ["completed"] });

  const projection = projectionFor(result, transcript.scenario);
  assertSemanticProjectionIntegrity(projection);
  assertVisibleTurnItemsMirrorLocalTurnItems(projection);
  assertRunOrdinals(projection, [1]);
  assertExecutionNodeKinds(projection, ["root_turn", "assistant_message"]);
  assertConversationMessageRoles(projection, ["user", "assistant"]);
  assertTurnItemTypes(projection, ["user_message", "assistant_message"]);
  assertUserMessagesInclude(projection, [SIMPLE_PROMPT]);
  assertAssistantTextIncludes(projection, "fixture simple ok");
  const turn = projection.providerTurns.find((turn) => turn.runAttemptId !== null);
  assert.isDefined(turn?.responseTiming?.firstOutputObservedAtMs);
  assert.isDefined(turn?.responseTiming?.executionCompletedAtMs);
  if (transcript.provider === "codex")
    assert.isAbove(turn?.responseTiming?.outputSampleCount ?? 0, 1);
}
