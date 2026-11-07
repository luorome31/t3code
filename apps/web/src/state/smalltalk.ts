import { Atom } from "effect/reactivity";
import { createSmalltalkAtoms } from "@t3tools/client-runtime/state/smalltalk";
import { connectionAtomRuntime } from "../connection/runtime";
export const smalltalkEnvironment = createSmalltalkAtoms(connectionAtomRuntime);
export const selectedSmalltalkAtom = Atom.family((_threadKey: string) =>
  Atom.make<string | null>(null),
);
