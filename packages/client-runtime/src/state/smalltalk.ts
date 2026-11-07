import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createSmalltalkAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const list = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "smalltalk:list",
    tag: WS_METHODS.smalltalkSubscribe,
  });
  const detail = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "smalltalk:detail",
    tag: WS_METHODS.smalltalkGet,
    refreshTrigger: (target) =>
      Atom.map(
        list({ environmentId: target.environmentId, input: { threadId: target.input.threadId } }),
        (result) =>
          AsyncResult.isSuccess(result)
            ? result.value.find((record) => record.id === target.input.id)?.status
            : undefined,
      ),
  });
  return {
    list,
    detail,
    mutate: createEnvironmentRpcCommand(runtime, {
      label: "smalltalk:mutate",
      tag: WS_METHODS.smalltalkMutate,
    }),
  };
}
