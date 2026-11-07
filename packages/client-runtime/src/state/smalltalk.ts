import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { Atom } from "effect/reactivity";
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
      list({ environmentId: target.environmentId, input: { threadId: target.input.threadId } }),
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
