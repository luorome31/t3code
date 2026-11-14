import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { MessageId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const DEFAULT_SMALLTALK_PROMPT =
  "用通俗、自然的语言解释这段回答。先说核心意思，再解释必要的术语，适当举例。保留原文的关键条件和不确定性，不添加原文没有的事实。简单内容简短解释。";
export const SYSTEM_SMALLTALK_PRESET_ID = "system";
export const SmalltalkPreset = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(100))),
  prompt: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(8000))),
});
export type SmalltalkPreset = typeof SmalltalkPreset.Type;
export const SYSTEM_SMALLTALK_PRESET: SmalltalkPreset = {
  id: SYSTEM_SMALLTALK_PRESET_ID,
  name: "说人话",
  prompt: DEFAULT_SMALLTALK_PROMPT,
};
export const SmalltalkStatus = Schema.Literals(["generating", "completed", "failed", "cancelled"]);
export const SMALLTALK_SOURCE_TEXT_MAX_LENGTH = 200_000;
export const SmalltalkSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("message"),
    sourceThreadId: ThreadId,
    messageId: MessageId,
  }),
  Schema.Struct({
    kind: Schema.Literal("markdown-file"),
    relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
    text: Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(SMALLTALK_SOURCE_TEXT_MAX_LENGTH),
    ),
  }),
]);
export type SmalltalkSource = typeof SmalltalkSource.Type;
const SMALLTALK_TEXT_GENERATION_DRIVERS = ["codex", "claudeAgent", "antigravity"] as const;
const SMALLTALK_TEXT_GENERATION_DRIVER_SET: ReadonlySet<string> = new Set(
  SMALLTALK_TEXT_GENERATION_DRIVERS,
);
export const isSmalltalkTextGenerationDriver = (driver: string | null | undefined): boolean =>
  typeof driver === "string" && SMALLTALK_TEXT_GENERATION_DRIVER_SET.has(driver);
export const SmalltalkSummary = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  messageId: MessageId,
  /** Set when the explanation came from a Markdown file rather than an answer. */
  filePath: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  title: Schema.String,
  status: SmalltalkStatus,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  streamingText: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type SmalltalkSummary = typeof SmalltalkSummary.Type;
export const Smalltalk = Schema.Struct({
  ...SmalltalkSummary.fields,
  sourceText: Schema.String,
  question: Schema.String,
  explanation: Schema.String,
  error: Schema.NullOr(Schema.String),
  modelSelection: Schema.NullOr(ModelSelection),
  requestedModelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  preset: SmalltalkPreset,
  requestedPreset: SmalltalkPreset,
  requestId: Schema.String,
});
export type Smalltalk = typeof Smalltalk.Type;
export const SmalltalkThreadInput = Schema.Struct({ threadId: ThreadId });
export const SmalltalkGetInput = Schema.Struct({ threadId: ThreadId, id: Schema.String });
export const SmalltalkMutation = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("create"),
    threadId: ThreadId,
    source: SmalltalkSource,
  }),
  // Legacy flat shape shipped by clients before file sources existed.
  Schema.Struct({
    action: Schema.Literal("create"),
    threadId: ThreadId,
    sourceThreadId: ThreadId,
    messageId: MessageId,
  }),
  Schema.Struct({
    action: Schema.Literal("regenerate"),
    threadId: ThreadId,
    id: Schema.String,
    presetId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    action: Schema.Literals(["cancel", "delete"]),
    threadId: ThreadId,
    id: Schema.String,
  }),
]);
export type SmalltalkMutation = typeof SmalltalkMutation.Type;
export class SmalltalkError extends Schema.TaggedError<SmalltalkError>()("SmalltalkError", {
  reason: Schema.Literals([
    "not_found",
    "invalid_source",
    "provider_unavailable",
    "storage",
    "configuration",
  ]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message() {
    switch (this.reason) {
      case "not_found":
        return "This Smalltalk or thread is no longer available.";
      case "invalid_source":
        return "Choose a completed, nonempty response in this thread.";
      case "provider_unavailable":
        return "The Smalltalk model is unavailable. Choose an available model in Settings.";
      case "configuration":
        return "The Smalltalk settings are invalid.";
      case "storage":
        return "Could not save or load Smalltalk.";
    }
  }
}
