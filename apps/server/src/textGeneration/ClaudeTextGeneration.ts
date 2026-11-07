import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { type ClaudeSettings, TextGenerationError } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { buildSmalltalkPrompt } from "@t3tools/provider-core/server/smalltalkPrompt";
import type {
  ProviderTextGeneration,
  SmalltalkGenerationInput,
} from "@t3tools/provider-core/server/textGeneration";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import {
  normalizeCliError,
  toJsonSchemaObject,
} from "@t3tools/provider-core/server/textGenerationUtils";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  type ClaudeModelCatalog,
  getClaudeCatalogModelCapabilities,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  resolveClaudeModelSlug,
  scopeClaudeModelCatalog,
} from "../provider/ClaudeModelCatalog.ts";
import {
  hasClaudeManagedMcpConfig,
  makeClaudeEnvironment,
} from "../provider/Drivers/ClaudeHome.ts";

const CLAUDE_TIMEOUT_MS = 180_000;
/** `--tools` takes bare names; patterns go in the allow list. */
const CLAUDE_INVESTIGATION_TOOLS = "Read,Grep,Glob,Bash";
/** In dontAsk mode every call outside this list, Bash included, is refused. */
const CLAUDE_INVESTIGATION_ALLOWED = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
].join(",");
// Denies override allows; block git --output/-o because allowed trailing args can otherwise write anywhere.
const CLAUDE_INVESTIGATION_DENIED = ["Bash(git * --output*)", "Bash(git * -o *)"].join(",");

const NO_SESSION_PERSISTENCE = "--no-session-persistence";
// Claude Code before 2.0.63 exits with this on stderr; those runs retry without the flag.
const NO_SESSION_PERSISTENCE_REJECTED = `error: unknown option '${NO_SESSION_PERSISTENCE}'`;

const ClaudeOutputEnvelope = Schema.Struct({
  structured_output: Schema.Unknown,
});
const ClaudeOutputMessage = Schema.Struct({
  type: Schema.String,
  structured_output: Schema.optionalKey(Schema.Unknown),
});
const isClaudeOutputEnvelope = Schema.is(ClaudeOutputEnvelope);

const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const isTextGenerationError = Schema.is(TextGenerationError);
const decodeClaudeOutput = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Union([ClaudeOutputEnvelope, Schema.Array(ClaudeOutputMessage)])),
);

// Only `success` results carry `result`; error subtypes such as
// error_max_structured_output_retries report through `errors` instead.
const ClaudeErrorResult = Schema.Struct({
  is_error: Schema.Literal(true),
  result: Schema.optionalKey(Schema.String),
  errors: Schema.optionalKey(Schema.Array(Schema.String)),
});
const isClaudeErrorResult = Schema.is(ClaudeErrorResult);
const decodeJsonOption = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

interface ClaudeStreamMessage {
  readonly type: string;
  readonly event?: {
    readonly type?: string;
    readonly delta?: {
      readonly type?: string;
      readonly text?: string;
    };
  };
  readonly result?: string;
  readonly is_error?: boolean;
  readonly errors?: ReadonlyArray<string>;
}

function decodeClaudeStreamMessage(line: string): ClaudeStreamMessage | undefined {
  const value = Option.getOrUndefined(decodeJsonOption(line));
  if (!value || typeof value !== "object" || !("type" in value)) return undefined;
  return typeof value.type === "string" ? (value as ClaudeStreamMessage) : undefined;
}

// Claude reports JSON errors on stdout; stderr may contain only wrapper notices.
function claudeErrorResult(stdout: string): string | undefined {
  const output = Option.getOrUndefined(decodeJsonOption(stdout));
  const messages: ReadonlyArray<unknown> = Array.isArray(output) ? output : [output];
  return messages
    .filter(isClaudeErrorResult)
    .map((message) =>
      (
        message.result ??
        // error_during_execution mixes CLI telemetry into the list.
        message.errors?.filter((error) => !error.startsWith("[ede_diagnostic]")).join("\n") ??
        ""
      ).trim(),
    )
    .findLast((result) => result.length > 0);
}

export const makeClaudeTextGeneration = Effect.fn("makeClaudeTextGeneration")(function* (
  claudeSettings: ClaudeSettings,
  environment?: NodeJS.ProcessEnv,
  modelCatalog: Effect.Effect<ClaudeModelCatalog> = Effect.succeed(BUNDLED_CLAUDE_MODEL_CATALOG),
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
  const scopedModelCatalog = modelCatalog.pipe(
    Effect.map((catalog) => scopeClaudeModelCatalog(catalog, claudeSettings.customModels)),
  );

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => acc + chunk,
      ),
      Effect.mapError((cause) =>
        normalizeCliError("claude", operation, cause, "Failed to collect process output"),
      ),
    );

  const encodeJsonForOperation = (
    operation: TextGenerationOperations.Operation,
    value: unknown,
    detail: string,
  ): Effect.Effect<string, TextGenerationError> =>
    encodeJsonString(value).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail,
            cause,
          }),
      ),
    );

  const runClaudeJson = Effect.fn("runClaudeJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchema: outputSchemaJson,
    modelSelection,
    investigate,
    onModelSelectionResolved,
  }: TextGenerationOperations.Request<S>): Effect.fn.Return<
    S["Type"],
    TextGenerationError,
    S["DecodingServices"]
  > {
    const catalog = yield* scopedModelCatalog;
    const resolvedModelSelection = {
      ...modelSelection,
      model: resolveClaudeModelSlug(catalog, modelSelection.model),
    };
    onModelSelectionResolved?.(resolvedModelSelection);
    const jsonSchemaStr = yield* encodeJsonForOperation(
      operation,
      toJsonSchemaObject(outputSchemaJson),
      "Failed to encode structured output schema.",
    );
    const caps = getClaudeCatalogModelCapabilities(catalog, resolvedModelSelection.model);
    const descriptors = getProviderOptionDescriptors({
      caps,
      selections: resolvedModelSelection.options,
    });
    const findDescriptor = (id: string) => descriptors.find((descriptor) => descriptor.id === id);
    const rawEffortSelection = getModelSelectionStringOptionValue(resolvedModelSelection, "effort");
    const resolvedEffort = resolveClaudeCatalogEffort(
      catalog,
      resolvedModelSelection.model,
      rawEffortSelection,
    );
    const cliEffort = normalizeClaudeCatalogEffort(
      catalog,
      resolvedEffort,
      resolvedModelSelection.model,
    );
    const ultracode = findDescriptor("ultracode")?.currentValue;
    const thinkingDescriptor = findDescriptor("thinking");
    const fastModeDescriptor = findDescriptor("fastMode");
    // Only a chosen value; otherwise Claude Code's own default applies, as in chat turns.
    const thinking =
      thinkingDescriptor?.type === "boolean"
        ? getModelSelectionBooleanOptionValue(resolvedModelSelection, "thinking")
        : undefined;
    const fastMode =
      fastModeDescriptor?.type === "boolean" ? fastModeDescriptor.currentValue : undefined;
    const settings = {
      disableAllHooks: true,
      ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
      ...(fastMode ? { fastMode: true } : {}),
      ...(typeof ultracode === "boolean" ? { ultracode } : {}),
    };
    const settingsJson = yield* encodeJsonForOperation(
      operation,
      settings,
      "Failed to encode Claude CLI settings.",
    );

    const runClaudeCommand = Effect.fn("runClaudeJson.runClaudeCommand")(function* (
      noSessionPersistence: boolean,
    ) {
      const workingDirectory =
        operation === "generateThreadTitle" || operation === "generateSmalltalk"
          ? yield* fileSystem
              .makeTempDirectoryScoped({ prefix: "t3code-claude-title-" })
              .pipe(
                Effect.mapError((cause) =>
                  normalizeCliError("claude", operation, cause, "Failed to create title directory"),
                ),
              )
          : cwd;
      const managedMcpConfig = yield* hasClaudeManagedMcpConfig();
      const spawnCommand = yield* resolveSpawnCommand(
        claudeSettings.binaryPath || "claude",
        [
          "-p",
          "--output-format",
          "json",
          "--json-schema",
          jsonSchemaStr,
          "--model",
          resolveClaudeCatalogApiModelId(catalog, resolvedModelSelection),
          ...(cliEffort ? ["--effort", cliEffort] : []),
          "--settings",
          settingsJson,
          ...(investigate
            ? [
                "--tools",
                CLAUDE_INVESTIGATION_TOOLS,
                "--allowedTools",
                CLAUDE_INVESTIGATION_ALLOWED,
                "--disallowedTools",
                CLAUDE_INVESTIGATION_DENIED,
              ]
            : ["--tools", ""]),
          "--disable-slash-commands",
          ...(noSessionPersistence ? [NO_SESSION_PERSISTENCE] : []),
          // managed-mcp.json already isolates servers and makes Claude reject this flag.
          ...(managedMcpConfig ? [] : ["--strict-mcp-config"]),
          "--permission-mode",
          "dontAsk",
        ],
        { env: claudeEnvironment },
      );
      const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: claudeEnvironment,
        cwd: workingDirectory,
        shell: spawnCommand.shell,
        stdin: {
          stream: Stream.encodeText(Stream.make(prompt)),
        },
        forceKillAfter: "1 second",
      });

      const child = yield* commandSpawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) =>
            normalizeCliError("claude", operation, cause, "Failed to spawn Claude CLI process"),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamAsString(operation, child.stdout),
          readStreamAsString(operation, child.stderr),
          child.exitCode.pipe(
            Effect.mapError((cause) =>
              normalizeCliError("claude", operation, cause, "Failed to read Claude CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      return { stdout, stderr, exitCode };
    });

    const rawStdout = yield* runClaudeCommand(true).pipe(
      Effect.filterOrElse(
        (result) =>
          result.exitCode === 0 || !result.stderr.includes(NO_SESSION_PERSISTENCE_REJECTED),
        () => runClaudeCommand(false),
      ),
      Effect.flatMap(({ stdout, stderr, exitCode }) => {
        if (exitCode === 0) return Effect.succeed(stdout);
        const stderrDetail = stderr.trim();
        const stdoutDetail = stdout.trim();
        const detail =
          claudeErrorResult(stdoutDetail) ??
          (stderrDetail.length > 0 ? stderrDetail : stdoutDetail);
        return Effect.fail(
          new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Claude CLI command failed: ${detail}`
                : `Claude CLI command failed with code ${exitCode}.`,
          }),
        );
      }),
      Effect.scoped,
      Effect.timeoutOption(investigate?.timeoutMs ?? CLAUDE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({ operation, detail: "Claude CLI request timed out." }),
            ),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

    const output = yield* decodeClaudeOutput(rawStdout).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Claude CLI returned unexpected output format.",
              cause,
            }),
          ),
      }),
    );
    const envelope = isClaudeOutputEnvelope(output)
      ? output
      : output.findLast((message) => message.type === "result");

    const decodeOutput = Schema.decodeEffect(outputSchemaJson);
    return yield* decodeOutput(envelope?.structured_output).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Claude returned invalid structured output.",
              cause,
            }),
          ),
      }),
    );
  });

  const runClaudeSmalltalk = Effect.fn("ClaudeTextGeneration.runSmalltalk")(function* (
    input: SmalltalkGenerationInput,
  ) {
    const operation = "generateSmalltalk";
    const catalog = yield* scopedModelCatalog;
    const resolvedModelSelection = {
      ...input.modelSelection,
      model: resolveClaudeModelSlug(catalog, input.modelSelection.model),
    };
    const caps = getClaudeCatalogModelCapabilities(catalog, resolvedModelSelection.model);
    const descriptors = getProviderOptionDescriptors({
      caps,
      selections: resolvedModelSelection.options,
    });
    const findDescriptor = (id: string) => descriptors.find((descriptor) => descriptor.id === id);
    const rawEffortSelection = getModelSelectionStringOptionValue(resolvedModelSelection, "effort");
    const resolvedEffort = resolveClaudeCatalogEffort(
      catalog,
      resolvedModelSelection.model,
      rawEffortSelection,
    );
    const cliEffort = normalizeClaudeCatalogEffort(
      catalog,
      resolvedEffort,
      resolvedModelSelection.model,
    );
    const ultracode = findDescriptor("ultracode")?.currentValue;
    const thinkingDescriptor = findDescriptor("thinking");
    const fastModeDescriptor = findDescriptor("fastMode");
    const thinking =
      thinkingDescriptor?.type === "boolean"
        ? getModelSelectionBooleanOptionValue(resolvedModelSelection, "thinking")
        : undefined;
    const fastMode =
      fastModeDescriptor?.type === "boolean" ? fastModeDescriptor.currentValue : undefined;
    const settingsJson = yield* encodeJsonForOperation(
      operation,
      {
        disableAllHooks: true,
        ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
        ...(fastMode ? { fastMode: true } : {}),
        ...(typeof ultracode === "boolean" ? { ultracode } : {}),
      },
      "Failed to encode Claude CLI settings.",
    );

    const runAttempt = Effect.fn("ClaudeTextGeneration.runSmalltalkAttempt")(
      function* (noSessionPersistence: boolean) {
        const workingDirectory = yield* fileSystem
          .makeTempDirectoryScoped({ prefix: "t3code-claude-smalltalk-" })
          .pipe(
            Effect.mapError((cause) =>
              normalizeCliError("claude", operation, cause, "Failed to create Smalltalk directory"),
            ),
          );
        const managedMcpConfig = yield* hasClaudeManagedMcpConfig().pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        );
        const spawnCommand = yield* resolveSpawnCommand(
          claudeSettings.binaryPath || "claude",
          [
            "-p",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
            "--model",
            resolveClaudeCatalogApiModelId(catalog, resolvedModelSelection),
            ...(cliEffort ? ["--effort", cliEffort] : []),
            "--settings",
            settingsJson,
            "--tools",
            "",
            "--disable-slash-commands",
            ...(noSessionPersistence ? [NO_SESSION_PERSISTENCE] : []),
            ...(managedMcpConfig ? [] : ["--strict-mcp-config"]),
            "--permission-mode",
            "dontAsk",
          ],
          { env: claudeEnvironment },
        );
        const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: claudeEnvironment,
          cwd: workingDirectory,
          shell: spawnCommand.shell,
          stdin: {
            stream: Stream.encodeText(Stream.make(buildSmalltalkPrompt(input, { format: "text" }))),
          },
          forceKillAfter: "1 second",
        });
        const child = yield* commandSpawner
          .spawn(command)
          .pipe(
            Effect.mapError((cause) =>
              normalizeCliError("claude", operation, cause, "Failed to spawn Claude CLI process"),
            ),
          );
        const emitted = yield* Ref.make(false);
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            child.stdout.pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.runFoldEffect(
                (): { text: string; result: string | undefined } => ({
                  text: "",
                  result: undefined,
                }),
                (state, line) => {
                  const message = decodeClaudeStreamMessage(line);
                  if (!message) return Effect.succeed(state);
                  if (
                    message.type === "stream_event" &&
                    message.event?.type === "content_block_delta" &&
                    message.event.delta?.type === "text_delta" &&
                    message.event.delta.text
                  ) {
                    const delta = message.event.delta.text;
                    return Ref.set(emitted, true).pipe(
                      Effect.andThen(input.onTextDelta?.(delta) ?? Effect.void),
                      Effect.as({ ...state, text: state.text + delta }),
                    );
                  }
                  if (message.type === "result") {
                    if (message.is_error) {
                      const detail =
                        message.result?.trim() ||
                        message.errors
                          ?.filter((error) => !error.startsWith("[ede_diagnostic]"))
                          .join("\n") ||
                        "Claude streamed an error.";
                      return Effect.fail(new TextGenerationError({ operation, detail }));
                    }
                    return Effect.succeed({
                      ...state,
                      result: message.result?.trim() || state.result,
                    });
                  }
                  return Effect.succeed(state);
                },
              ),
            ),
            readStreamAsString(operation, child.stderr),
            child.exitCode.pipe(
              Effect.mapError((cause) =>
                normalizeCliError(
                  "claude",
                  operation,
                  cause,
                  "Failed to read Claude CLI exit code",
                ),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );
        return { ...stdout, stderr, exitCode, emitted: yield* Ref.get(emitted) };
      },
      (effect) => effect.pipe(Effect.scoped),
    );

    const run = Effect.gen(function* () {
      const first = yield* runAttempt(true);
      if (
        first.exitCode !== 0 &&
        first.stderr.includes(NO_SESSION_PERSISTENCE_REJECTED) &&
        !first.emitted
      ) {
        yield* Effect.logDebug("Retrying Claude Smalltalk without session persistence.");
        return yield* runAttempt(false);
      }
      return first;
    });

    const result = yield* run.pipe(
      Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({ operation, detail: "Claude CLI request timed out." }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.result?.trim();
      return yield* new TextGenerationError({
        operation,
        detail:
          detail && detail.length > 0
            ? `Claude CLI command failed: ${detail}`
            : `Claude CLI command failed with code ${result.exitCode}.`,
      });
    }
    const explanation = (result.result || result.text).trim();
    if (!explanation) {
      return yield* new TextGenerationError({
        operation,
        detail: "Claude returned empty output.",
      });
    }
    return { explanation, modelSelection: resolvedModelSelection };
  });

  const generateSmalltalk: ProviderTextGeneration["generateSmalltalk"] = (input) =>
    runClaudeSmalltalk(input).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: "generateSmalltalk",
              detail: "Claude Smalltalk generation failed.",
              cause,
            }),
      ),
    );

  return TextGenerationOperations.fromRunner("ClaudeTextGeneration", runClaudeJson, {
    generateSmalltalk,
  });
});
