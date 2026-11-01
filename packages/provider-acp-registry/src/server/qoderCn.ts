import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as AcpErrors from "effect-acp/errors";

import type { AcpRegistrySettings } from "../settings.ts";

export const QODER_CN_CONTEXT_OPTION_ID = "contextWindow";
export type QoderCnModelOptions = Readonly<Record<string, ReadonlyArray<ProviderOptionDescriptor>>>;

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
    return Number(exitCode) === 0 && !stdout.truncated && !stdout.invalidUtf8
      ? parseQoderCnModelOptions(stdout.text)
      : {};
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
