import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import type {
  ModelSelection,
  ProviderOptionDescriptor,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as AcpErrors from "effect-acp/errors";

import type { AcpRegistrySettings } from "../settings.ts";

export const QODER_CN_CONTEXT_OPTION_ID = "contextWindow";
export type QoderCnModelOptions = Readonly<Record<string, ReadonlyArray<ProviderOptionDescriptor>>>;

const QoderCnQuotaAmount = Schema.Struct({
  total: Schema.optional(Schema.Number),
  used: Schema.optional(Schema.Number),
  remaining: Schema.optional(Schema.Number),
  percentage: Schema.optional(Schema.Number),
  unit: Schema.optional(Schema.String),
});
export type QoderCnQuotaAmount = typeof QoderCnQuotaAmount.Type;

const QoderCnOrgQuota = Schema.Struct({
  used: Schema.optional(Schema.Number),
  cap: Schema.optional(Schema.Number),
  remaining: Schema.optional(Schema.Number),
  percentage: Schema.optional(Schema.Number),
  available: Schema.optional(Schema.Boolean),
  unit: Schema.optional(Schema.String),
});
export type QoderCnOrgQuota = typeof QoderCnOrgQuota.Type;

const QoderCnQuotaUsage = Schema.Struct({
  userId: Schema.optional(Schema.String),
  userType: Schema.optional(Schema.String),
  totalUsagePercentage: Schema.optional(Schema.Number),
  expiresAt: Schema.optional(Schema.Number),
  isQuotaExceeded: Schema.optional(Schema.Boolean),
  usageType: Schema.optional(Schema.String),
  userQuota: Schema.optional(QoderCnQuotaAmount),
  orgResourcePackage: Schema.optional(QoderCnOrgQuota),
  isPlanQuotaProrated: Schema.optional(Schema.Boolean),
});
export type QoderCnQuotaUsage = typeof QoderCnQuotaUsage.Type;

const decodeUsageResponse = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal("control_response"),
      response: Schema.Struct({
        subtype: Schema.Literal("success"),
        request_id: Schema.String,
        response: Schema.Struct({
          usage: Schema.NullOr(QoderCnQuotaUsage),
          usage_error: Schema.optional(Schema.String),
        }),
      }),
    }),
  ),
);

export interface QoderCnUsageResponse {
  readonly usage: QoderCnQuotaUsage | null;
  readonly usageError?: string;
}

export function parseQoderCnUsageResponse(line: string): QoderCnUsageResponse | undefined {
  const decoded = decodeUsageResponse(line);
  if (Option.isNone(decoded)) return undefined;
  const response = decoded.value.response.response;
  return {
    usage: response.usage,
    ...(response.usage_error ? { usageError: response.usage_error } : {}),
  };
}

export type QoderCnUsageRead =
  | { readonly status: "ok"; readonly usage: QoderCnQuotaUsage }
  | { readonly status: "unauthenticated" }
  | { readonly status: "unsupported"; readonly detail?: string }
  | { readonly status: "failed"; readonly detail?: string };

const MONTH_MINS = 30 * 24 * 60;

function usageAmount(
  quota:
    | {
        readonly remaining?: number | undefined;
        readonly total?: number | undefined;
        readonly unit?: string | undefined;
      }
    | undefined,
): ServerProviderUsageWindow["amount"] {
  if (
    quota === undefined ||
    typeof quota.remaining !== "number" ||
    !Number.isFinite(quota.remaining) ||
    typeof quota.total !== "number" ||
    !Number.isFinite(quota.total) ||
    quota.total <= 0
  ) {
    return undefined;
  }
  return {
    remaining: Math.max(0, quota.remaining),
    total: quota.total,
    unit: quota.unit?.trim() || "credits",
  };
}

function usageFingerprint(userId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`qodercn\0${userId}`)));
}

// The CLI uses 32503651200000 (year 3000) as its "no expiry" sentinel.
const NO_EXPIRY_MS = 32_503_651_200_000;

function usageResetsAt(expiresAt: number | undefined): string | undefined {
  if (
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    expiresAt >= NO_EXPIRY_MS
  ) {
    return undefined;
  }
  return Option.match(DateTime.make(expiresAt), {
    onNone: () => undefined,
    onSome: DateTime.formatIso,
  });
}

export function qoderCnUsageLimits(input: {
  readonly usage: QoderCnQuotaUsage;
  readonly checkedAt: string;
}): ServerProviderUsageLimits | undefined {
  const { usage, checkedAt } = input;
  const resetsAt = usageResetsAt(usage.expiresAt);
  const prorated = usage.isPlanQuotaProrated === true;
  const windowDurationMins = prorated ? undefined : MONTH_MINS;
  const windows: Array<ServerProviderUsageWindow> = [];

  const userQuota = usage.userQuota;
  const usedPercent = userQuota?.percentage ?? usage.totalUsagePercentage;
  if (typeof usedPercent === "number" && Number.isFinite(usedPercent)) {
    const amount = usageAmount(userQuota);
    windows.push({
      id: "monthly_credits",
      kind: "monthly",
      label:
        usage.usageType === "credits" || userQuota?.unit?.trim() === "credits"
          ? "Monthly credits"
          : "Monthly",
      usedPercent: clampPercent(
        usage.isQuotaExceeded === true ? Math.max(usedPercent, 100) : usedPercent,
      ),
      ...(resetsAt ? { resetsAt } : {}),
      ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
      ...(amount ? { amount } : {}),
    });
  }

  const org = usage.orgResourcePackage;
  if (
    org !== undefined &&
    org.available !== false &&
    typeof org.cap === "number" &&
    Number.isFinite(org.cap) &&
    org.cap > 0
  ) {
    const orgPercent = org.percentage ?? ((org.used ?? 0) / org.cap) * 100;
    const amount = usageAmount({
      remaining: org.remaining,
      total: org.cap,
      unit: org.unit,
    });
    windows.push({
      id: "org_credits",
      kind: "monthly",
      label: "Organization credits",
      usedPercent: clampPercent(orgPercent),
      ...(resetsAt ? { resetsAt } : {}),
      ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
      ...(amount ? { amount } : {}),
    });
  }

  if (windows.length === 0) return undefined;
  return {
    ...makeUsageLimits({ checkedAt, windows }),
    ...(usage.userId ? { credentialFingerprint: usageFingerprint(usage.userId) } : {}),
  };
}

export function isQoderCn(settings: AcpRegistrySettings): boolean {
  return (
    settings.source === "local" &&
    /^(qodercn|qoderclicn|qoder-cn)(\.exe|\.cmd)?$/iu.test(
      settings.commandPath.split(/[\\/]/u).pop() ?? "",
    )
  );
}

const Model = Schema.Struct({
  modelId: Schema.String,
  isEnabled: Schema.optional(Schema.Boolean),
  efforts: Schema.optional(Schema.Array(Schema.String)),
  supportsDisabled: Schema.optional(Schema.Boolean),
  defaultEffort: Schema.optional(Schema.String),
  availableContextWindows: Schema.optional(Schema.Array(Schema.Number)),
  defaultContextWindow: Schema.optional(Schema.Number),
});
const decodeResponse = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal("control_response"),
      response: Schema.Struct({
        subtype: Schema.Literal("success"),
        request_id: Schema.Literal("t3-model-options"),
        response: Schema.Struct({ models: Schema.Array(Schema.Unknown) }),
      }),
    }),
  ),
);
const decodeModel = Schema.decodeUnknownOption(Model);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const canonicalId = (value: string) =>
  value.length > 0 && value.length <= 128 && value === value.trim();

export function parseQoderCnModelOptions(output: string): QoderCnModelOptions {
  const entries: Array<readonly [string, ReadonlyArray<ProviderOptionDescriptor>]> = [];
  for (const line of output.split("\n")) {
    const response = decodeResponse(line);
    if (Option.isNone(response)) continue;
    for (const candidate of response.value.response.response.models.slice(0, 256)) {
      const decoded = decodeModel(candidate);
      if (Option.isNone(decoded)) continue;
      const model = decoded.value;
      if (!canonicalId(model.modelId) || model.isEnabled === false) continue;
      const descriptors: Array<ProviderOptionDescriptor> = [];
      const efforts = [...new Set(model.efforts ?? [])].filter(canonicalId).slice(0, 63);
      if (model.supportsDisabled && !efforts.includes("none")) efforts.push("none");
      if (efforts.length > 0) {
        descriptors.push({
          id: "reasoning_effort",
          label: "Reasoning Effort",
          type: "select",
          role: "reasoning",
          options: efforts.map((id) => ({
            id,
            label:
              id === "xhigh"
                ? "Extra High"
                : id === "none"
                  ? "None"
                  : id.charAt(0).toUpperCase() + id.slice(1),
          })),
          ...(model.defaultEffort && efforts.includes(model.defaultEffort)
            ? { currentValue: model.defaultEffort }
            : {}),
        });
      }
      const windows = [...new Set(model.availableContextWindows ?? [])]
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .sort((a, b) => a - b)
        .slice(0, 63);
      if (windows.length > 0) {
        descriptors.push({
          id: QODER_CN_CONTEXT_OPTION_ID,
          label: "Context window",
          description: "Applied on the next turn. Conversation history is preserved.",
          type: "select",
          currentValue: "default",
          options: [
            { id: "default", label: "Default" },
            ...windows.map((value) => ({
              id: String(value),
              label:
                value % 1_000_000 === 0
                  ? `${value / 1_000_000}M`
                  : value % 1_000 === 0
                    ? `${value / 1_000}K`
                    : String(value),
              ...(value === model.defaultContextWindow ? { isDefault: true } : {}),
            })),
          ],
        });
      }
      entries.push([model.modelId, descriptors]);
    }
  }
  return Object.fromEntries(entries);
}

type Spawn = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly shell?: boolean;
};

const decodeDaemonResponse = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal("control_response"),
      response: Schema.Struct({
        subtype: Schema.String,
        request_id: Schema.String,
      }),
    }),
  ),
);

const decodeDaemonError = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.Literal("control_response"),
      response: Schema.Struct({
        subtype: Schema.Literal("error"),
        request_id: Schema.String,
        error: Schema.optional(Schema.String),
        code: Schema.optional(Schema.String),
      }),
    }),
  ),
);

function daemonErrorDetail(line: string): string {
  const decoded = decodeDaemonError(line);
  if (Option.isNone(decoded)) return line;
  return decoded.value.response.error ?? decoded.value.response.code ?? line;
}

interface DaemonRequest {
  readonly id: string;
  readonly body: unknown;
}

const DAEMON_INITIALIZE: DaemonRequest = {
  id: "t3-initialize",
  body: {
    subtype: "daemon.initialize",
    daemon_protocol_version: 2,
    sdk_version: "t3-code",
    capabilities: ["multi_session_v2"],
    auth: { type: "qodercli" },
  },
};
const DAEMON_AUTHENTICATE: DaemonRequest = {
  id: "t3-authenticate",
  body: { subtype: "daemon.authenticate" },
};

const readDaemonResponses = Effect.fn("QoderCn.readDaemonResponses")(function* (
  spawn: Spawn,
  requests: ReadonlyArray<DaemonRequest>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const outgoing = yield* Queue.make<Uint8Array>();
  const responses = yield* Effect.forEach(requests, () => Deferred.make<string, Error>());
  const child = yield* spawner.spawn(
    ChildProcess.make(spawn.command, [...spawn.args.filter((arg) => arg !== "--acp"), "--sdk"], {
      cwd: spawn.cwd,
      env: spawn.env,
      shell: spawn.shell ?? false,
      stdin: Stream.fromQueue(outgoing),
    }),
  );
  yield* child.stderr.pipe(Stream.runDrain, Effect.forkScoped);
  yield* child.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.take(32),
    Stream.runForEach((line) => {
      if (line.length > 2 * 1024 * 1024) return Effect.void;
      const decoded = decodeDaemonResponse(line);
      if (Option.isNone(decoded)) return Effect.void;
      const index = requests.findIndex(
        (request) => request.id === decoded.value.response.request_id,
      );
      const response = responses[index];
      if (response === undefined) return Effect.void;
      return decoded.value.response.subtype === "success"
        ? Deferred.succeed(response, line)
        : Deferred.fail(response, new Error(daemonErrorDetail(line)));
    }),
    Effect.ensuring(
      Effect.forEach(responses, (response) =>
        Deferred.fail(response, new Error("Qoder CN SDK metadata stream closed")),
      ),
    ),
    Effect.forkScoped,
  );
  const output = new Map<string, string>();
  for (const [index, request] of requests.entries()) {
    yield* Queue.offer(
      outgoing,
      new TextEncoder().encode(
        `${encodeJson({ type: "control_request", request_id: request.id, request: request.body })}\n`,
      ),
    );
    output.set(request.id, yield* Deferred.await(responses[index]!));
  }
  return output;
}, Effect.scoped);

const readDaemonModelOptions = Effect.fn("QoderCn.readDaemonModelOptions")(function* (
  spawn: Spawn,
) {
  const responses = yield* readDaemonResponses(spawn, [
    DAEMON_INITIALIZE,
    DAEMON_AUTHENTICATE,
    {
      id: "t3-model-options",
      body: { subtype: "daemon.get_models", fetchStrategy: "live" },
    },
  ]);
  return parseQoderCnModelOptions(responses.get("t3-model-options") ?? "");
});

const readDaemonUsageInfo = Effect.fn("QoderCn.readDaemonUsageInfo")(function* (spawn: Spawn) {
  const responses = yield* readDaemonResponses(spawn, [
    DAEMON_INITIALIZE,
    DAEMON_AUTHENTICATE,
    { id: "t3-usage", body: { subtype: "daemon.get_usage_info" } },
  ]);
  return parseQoderCnUsageResponse(responses.get("t3-usage") ?? "");
});

function isUnsupportedDaemonMethod(detail: string): boolean {
  return /METHOD_NOT_FOUND|Unsupported control request type|unknown daemon method/iu.test(detail);
}

export const readQoderCnUsageInfo = Effect.fn("QoderCn.readUsageInfo")(
  function* (spawn: Spawn) {
    const result = yield* Effect.result(readDaemonUsageInfo(spawn));
    if (Result.isFailure(result)) {
      const detail = result.failure.message;
      return isUnsupportedDaemonMethod(detail)
        ? ({ status: "unsupported", detail } as const)
        : ({ status: "failed", detail } as const);
    }
    const response = result.success;
    if (response === undefined) {
      return { status: "failed", detail: "Qoder CN returned no usage data." } as const;
    }
    if (response.usage === null) {
      return response.usageError
        ? ({ status: "failed", detail: response.usageError } as const)
        : ({ status: "unauthenticated" } as const);
    }
    return { status: "ok", usage: response.usage } as const;
  },
  Effect.timeout("15 seconds"),
  Effect.orElseSucceed((): QoderCnUsageRead => ({ status: "failed" })),
);

export const readQoderCnUsageLimits = Effect.fn("QoderCn.readUsageLimits")(function* (
  spawn: Spawn,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const result = yield* readQoderCnUsageInfo(spawn);
  switch (result.status) {
    case "ok":
      return qoderCnUsageLimits({ usage: result.usage, checkedAt });
    case "unauthenticated":
      return undefined;
    case "unsupported":
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "unsupported",
        message: "Update Qoder CN CLI to 1.1.73 or newer to see usage.",
      });
    case "failed":
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message:
          result.detail === undefined
            ? "Could not read Qoder CN usage. Refresh provider status to retry."
            : `Could not read Qoder CN usage: ${result.detail}`,
      });
  }
});

export const readQoderCnModelOptions = Effect.fn("QoderCn.readModelOptions")(
  function* (spawn: Spawn) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const request = encodeJson({
      type: "control_request",
      request_id: "t3-model-options",
      request: { subtype: "get_models", fetchStrategy: "live" },
    });
    // This SDK control request lists model metadata without sending a user prompt.
    const child = yield* spawner.spawn(
      ChildProcess.make(
        spawn.command,
        [
          ...spawn.args.filter((arg) => arg !== "--acp"),
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "-p",
        ],
        {
          cwd: spawn.cwd,
          env: spawn.env,
          shell: spawn.shell ?? false,
          stdin: Stream.make(new TextEncoder().encode(`${request}\n`)),
        },
      ),
    );
    const [stdout, , exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({ stream: child.stdout, maxBytes: 2 * 1024 * 1024 }),
        Stream.runDrain(child.stderr),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    if (Number(exitCode) !== 0 || stdout.truncated || stdout.invalidUtf8) return {};
    const models = parseQoderCnModelOptions(stdout.text);
    // CLI 1.1.81 moved account queries from print mode to the SDK daemon protocol.
    return Object.keys(models).length > 0 ? models : yield* readDaemonModelOptions(spawn);
  },
  Effect.scoped,
  Effect.timeout("15 seconds"),
  Effect.orElseSucceed((): QoderCnModelOptions => ({})),
);

export function qoderCnRuntimeConfigurationKey(selection: ModelSelection): string {
  return encodeJson([
    selection.model,
    selection.options?.find((option) => option.id === QODER_CN_CONTEXT_OPTION_ID)?.value ?? null,
  ]);
}

export const qoderCnSpawnArgs = Effect.fn("QoderCn.spawnArgs")(function* (
  spawn: Spawn,
  selection: ModelSelection,
) {
  const value = selection.options?.find(
    (option) => option.id === QODER_CN_CONTEXT_OPTION_ID,
  )?.value;
  const modelArgs = selection.model === "default" ? [] : ["--model", selection.model];
  const models = yield* readQoderCnModelOptions(spawn);
  const context = models[selection.model]?.find(
    (option) => option.id === QODER_CN_CONTEXT_OPTION_ID,
  );
  const configuredWindow = spawn.args.reduce<string | undefined>(
    (current, arg, index, args) =>
      arg === "--context-window"
        ? args[index + 1]
        : arg.startsWith("--context-window=")
          ? arg.slice("--context-window=".length)
          : current,
    undefined,
  );
  const requested = value ?? configuredWindow ?? "default";
  const choice =
    context?.type === "select"
      ? context.options.find((option) =>
          requested === "default" ? option.isDefault : option.id === requested,
        )
      : undefined;
  if (choice === undefined) {
    if (value === undefined) return [...spawn.args, ...modelArgs];
    return yield* AcpErrors.AcpRequestError.invalidParams(
      "The selected Qoder CN context window is unavailable for this model. Refresh the provider and choose another context window.",
    );
  }
  // A flag also overrides a context window restored from the native transcript.
  return [...spawn.args, ...modelArgs, "--context-window", choice.id];
});
