import { createSmalltalkAtoms } from "@t3tools/client-runtime/state/smalltalk";
import { connectionAtomRuntime } from "../connection/runtime";
export const smalltalkEnvironment = createSmalltalkAtoms(connectionAtomRuntime);
