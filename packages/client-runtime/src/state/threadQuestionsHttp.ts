import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import type { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";

export const fetchEnvironmentThreadQuestions = Effect.fn(
  "clientRuntime.state.fetchEnvironmentThreadQuestions",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly after?: number;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization?: Option.Option<RemoteEnvironmentAuthorization["Service"]>;
}) {
  const endpoint = {
    params: { threadId: input.threadId },
    query: input.after === undefined ? {} : { after: String(input.after) },
  };
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    ...input,
    group: "orchestration",
    method: "GET",
    url: (urls) => urls.threadQuestions(endpoint),
    timeoutMs: 15_000,
    request: ({ client, headers }) =>
      client.threadQuestions({
        ...endpoint,
        headers: withOrchestrationProtocolHeader(headers),
      }),
  });
});
