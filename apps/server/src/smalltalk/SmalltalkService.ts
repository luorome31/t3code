import {
  SMALLTALK_SOURCE_TEXT_MAX_LENGTH,
  Smalltalk,
  SmalltalkError,
  SmalltalkSummary,
  SYSTEM_SMALLTALK_PRESET,
  MessageId,
  type SmalltalkMutation,
  type ThreadId,
  type ServerSettings,
  isProviderAvailable,
  isProviderTextGenerationCapable,
  isSmalltalkTextGenerationDriver,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export class SmalltalkService extends Context.Service<
  SmalltalkService,
  {
    readonly get: (input: {
      threadId: ThreadId;
      id: string;
    }) => Effect.Effect<Smalltalk, SmalltalkError>;
    readonly mutate: (input: SmalltalkMutation) => Effect.Effect<Smalltalk | null, SmalltalkError>;
    readonly subscribe: (input: {
      threadId: ThreadId;
    }) => Stream.Stream<readonly SmalltalkSummary[], SmalltalkError>;
  }
>()("t3/smalltalk/SmalltalkService") {}

const storageError = (cause: unknown) => new SmalltalkError({ reason: "storage", cause });
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Smalltalk));
const encode = Schema.encodeEffect(Schema.fromJsonString(Smalltalk));
const decodeSummaries = Schema.decodeUnknownEffect(Schema.Array(SmalltalkSummary));
const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
const PROGRESS_FLUSH_CHARS = 24;
const plainExcerptTitle = (text: string) => text.replace(/\s+/g, " ").slice(0, 100);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const providers = yield* ProviderRegistry.ProviderInstanceRegistry;
  const settingsService = yield* ServerSettingsService.ServerSettingsService;
  const generation = yield* TextGeneration.TextGeneration;
  const fs = yield* FileSystem.FileSystem;
  const random = yield* SecureRandom.SecureRandom;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const revisions = yield* SubscriptionRef.make<ReadonlyMap<ThreadId, number>>(new Map());
  const fibers = new Map<string, Fiber.Fiber<void, never>>();

  // A CLI request cannot safely be replayed after a restart: it may already have incurred usage.
  yield* sql`UPDATE smalltalk SET status = 'failed', payload_json = json_set(payload_json,
    '$.status', 'failed', '$.error', 'Generation was interrupted by a server restart. Retry to continue.',
    '$.streamingText', '')
    WHERE status = 'generating'`.pipe(Effect.mapError(storageError));

  const notify = Effect.fn("SmalltalkService.notify")(function (threadId: ThreadId) {
    return SubscriptionRef.update(revisions, (current) =>
      new Map(current).set(threadId, (current.get(threadId) ?? 0) + 1),
    );
  });
  const requireThread = Effect.fn("SmalltalkService.requireThread")(function* (threadId: ThreadId) {
    const rows =
      yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId} AND deleted_at IS NULL`.pipe(
        Effect.mapError(storageError),
      );
    if (rows.length === 0) return yield* new SmalltalkError({ reason: "not_found" });
  });
  const list = Effect.fn("SmalltalkService.list")(function* (threadId: ThreadId) {
    yield* requireThread(threadId);
    const rows =
      yield* sql`SELECT id, thread_id AS "threadId", source_thread_id AS "sourceThreadId",
      message_id AS "messageId", json_extract(payload_json, '$.filePath') AS "filePath",
      title, status, created_at AS "createdAt", updated_at AS "updatedAt",
      COALESCE(json_extract(payload_json, '$.streamingText'), '') AS "streamingText"
      FROM smalltalk WHERE thread_id = ${threadId} ORDER BY created_at DESC, id DESC`.pipe(
        Effect.mapError(storageError),
      );
    return yield* decodeSummaries(rows).pipe(Effect.mapError(storageError));
  });
  const get = Effect.fn("SmalltalkService.get")(function* (input: {
    threadId: ThreadId;
    id: string;
  }) {
    yield* requireThread(input.threadId);
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM smalltalk WHERE id = ${input.id} AND thread_id = ${input.threadId}`.pipe(
      Effect.mapError(storageError),
    );
    if (!rows[0]) return yield* new SmalltalkError({ reason: "not_found" });
    return yield* decode(rows[0].payload_json).pipe(Effect.mapError(storageError));
  });
  const save = Effect.fn("SmalltalkService.save")(function* (
    record: Smalltalk,
    previousRequestId: string,
  ) {
    const json = yield* encode(record).pipe(Effect.mapError(storageError));
    const rows =
      yield* sql`UPDATE smalltalk SET status = ${record.status}, updated_at = ${record.updatedAt},
      request_id = ${record.requestId}, payload_json = ${json}
      WHERE id = ${record.id} AND thread_id = ${record.threadId} AND request_id = ${previousRequestId}
      RETURNING id`.pipe(Effect.mapError(storageError));
    if (rows.length > 0) yield* notify(record.threadId);
  });
  const saveProgress = Effect.fn("SmalltalkService.saveProgress")(function* (
    record: Smalltalk,
    text: string,
  ) {
    const updatedAt = yield* now;
    const rows = yield* sql`UPDATE smalltalk SET updated_at = ${updatedAt},
      payload_json = json_set(payload_json, '$.streamingText', ${text}, '$.updatedAt', ${updatedAt})
      WHERE id = ${record.id} AND thread_id = ${record.threadId}
        AND request_id = ${record.requestId} AND status = 'generating'
      RETURNING id`.pipe(Effect.mapError(storageError));
    if (rows.length > 0) yield* notify(record.threadId);
  });
  const choosePreset = (settings: ServerSettings, presetId?: string) => {
    const id = presetId ?? settings.smalltalkDefaultPresetId;
    return (
      settings.smalltalkPresets.find(
        (preset) => preset.id === id && id !== SYSTEM_SMALLTALK_PRESET.id,
      ) ?? SYSTEM_SMALLTALK_PRESET
    );
  };
  const start = Effect.fn("SmalltalkService.start")(function* (
    record: Smalltalk,
    settings: ServerSettings,
    presetId?: string,
  ) {
    if (record.status === "generating" && fibers.has(record.id)) return record;
    const owner = yield* threads
      .getThreadRecords(record.threadId, [])
      .pipe(Effect.mapError((cause) => new SmalltalkError({ reason: "not_found", cause })));
    settings = resolveProjectSettings(settings, owner.thread.projectId).settings;
    const selection = settings.smalltalkModelSelection ?? settings.textGenerationModelSelection;
    const instance = yield* providers
      .getInstance(selection.instanceId)
      .pipe(Effect.mapError(() => new SmalltalkError({ reason: "provider_unavailable" })));
    const snapshot = instance ? yield* instance.snapshot.getSnapshot : undefined;
    // These runners isolate the request and disable external integrations; other drivers need equivalent guarantees.
    const supported = isSmalltalkTextGenerationDriver(instance?.driverKind);
    const available =
      snapshot &&
      snapshot.enabled &&
      snapshot.installed &&
      snapshot.auth.status !== "unauthenticated" &&
      isProviderAvailable(snapshot) &&
      isProviderTextGenerationCapable(snapshot) &&
      resolveProjectProviderInstanceEnabled(settings, owner.thread.projectId, selection.instanceId);
    const next: Smalltalk = {
      ...record,
      requestId: yield* random.uuidV4(),
      updatedAt: yield* now,
      streamingText: "",
      requestedPreset: choosePreset(settings, presetId),
      requestedModelSelection: selection,
      preset: record.explanation ? record.preset : choosePreset(settings, presetId),
      status: available && supported ? "generating" : "failed",
      error:
        available && supported
          ? null
          : new SmalltalkError({ reason: "provider_unavailable" }).message,
    };
    yield* save(next, record.requestId);
    if (next.status !== "generating") return next;
    const progress = yield* Ref.make({ text: "", persistedLength: 0 });
    const flushProgress = Effect.fn("SmalltalkService.flushProgress")(function* (force: boolean) {
      const current = yield* Ref.get(progress);
      if (current.text.length === current.persistedLength) return;
      if (!force && current.text.length - current.persistedLength < PROGRESS_FLUSH_CHARS) return;
      yield* saveProgress(next, current.text).pipe(
        Effect.catchCause((cause) => Effect.logDebug("Could not save Smalltalk progress.", cause)),
      );
      yield* Ref.update(progress, (value) => ({
        ...value,
        persistedLength: current.text.length,
      }));
    });
    const onTextDelta = (delta: string) =>
      Ref.updateAndGet(progress, (current) => ({
        ...current,
        text: current.text + delta,
      })).pipe(Effect.andThen(flushProgress(false)));
    const work = Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-smalltalk-" });
        return yield* generation.generateSmalltalk({
          cwd,
          sourceText: next.sourceText,
          question: next.question,
          instructions: next.requestedPreset.prompt,
          modelSelection: selection,
          onTextDelta,
        });
      }),
    ).pipe(
      Effect.timeout("3 minutes"),
      Effect.matchCauseEffect({
        onSuccess: (result) =>
          lock.withPermit(
            Effect.gen(function* () {
              const current = yield* get(next);
              if (current.requestId !== next.requestId || current.status !== "generating") return;
              yield* save(
                {
                  ...current,
                  status: "completed",
                  error: null,
                  explanation: result.explanation,
                  streamingText: "",
                  modelSelection: result.modelSelection,
                  preset: next.requestedPreset,
                  updatedAt: yield* now,
                },
                next.requestId,
              );
            }),
          ),
        onFailure: (cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : lock.withPermit(
                Effect.gen(function* () {
                  const current = yield* get(next);
                  if (current.requestId !== next.requestId || current.status !== "generating")
                    return;
                  yield* save(
                    {
                      ...current,
                      status: "failed",
                      error:
                        "Could not generate this explanation. Check the Smalltalk model in Settings and retry.",
                      streamingText: "",
                      updatedAt: yield* now,
                    },
                    next.requestId,
                  );
                }),
              ),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          if (fibers.get(next.id) === fiber) fibers.delete(next.id);
        }),
      ),
      Effect.ignore({ log: true }),
    );
    const fiber = yield* work.pipe(Effect.forkIn(scope));
    fibers.set(next.id, fiber);
    return next;
  });
  const mutate = Effect.fn("SmalltalkService.mutate")(function (input: SmalltalkMutation) {
    return lock.withPermit(
      Effect.gen(function* () {
        yield* requireThread(input.threadId);
        if (input.action === "create") {
          const source =
            "source" in input
              ? input.source
              : {
                  kind: "message" as const,
                  sourceThreadId: input.sourceThreadId,
                  messageId: input.messageId,
                };
          if ("text" in source && !source.text.trim()) {
            return yield* new SmalltalkError({ reason: "invalid_source" });
          }
          // The SQL unique key treats message_id as source identity, so excerpt and note
          // sources store under synthesized ids that stay independent of the message
          // record; the payload keeps the real message id for excerpt jump-backs.
          let sourceThreadId: ThreadId;
          let storageMessageId: MessageId;
          let excerptQuestion = "";
          if (source.kind === "markdown-file") {
            sourceThreadId = input.threadId;
            storageMessageId = MessageId.make(`file:${source.relativePath}`);
          } else if (source.kind === "highlight-note") {
            sourceThreadId = input.threadId;
            storageMessageId = MessageId.make(`note:${source.noteId}`);
          } else if (source.kind === "excerpt") {
            const projection = yield* threads
              .getThreadProjection(input.threadId)
              .pipe(
                Effect.mapError((cause) => new SmalltalkError({ reason: "invalid_source", cause })),
              );
            // Fork-inherited items carry their origin thread; the client only knows the displayed one.
            const visible = projection.visibleTurnItems.find(
              (entry) =>
                entry.item.type === "assistant_message" &&
                entry.item.messageId === source.messageId &&
                entry.item.status === "completed",
            );
            if (!visible) return yield* new SmalltalkError({ reason: "invalid_source" });
            const records = yield* threads
              .getThreadRecords(visible.sourceThreadId, ["messages", "runs"], {
                messageIds: [source.messageId],
              })
              .pipe(
                Effect.mapError((cause) => new SmalltalkError({ reason: "invalid_source", cause })),
              );
            const message = records.messages.find(
              (row) => row.id === source.messageId && row.role === "assistant" && !row.streaming,
            );
            const run = records.runs.find((row) => row.id === message?.runId);
            if (!message || !message.text.trim() || run?.status === "running") {
              return yield* new SmalltalkError({ reason: "invalid_source" });
            }
            const related = yield* threads
              .getThreadRecords(visible.sourceThreadId, ["messages"], {
                messageRoles: ["user"],
                messageRunIds: message.runId === null ? [] : [message.runId],
              })
              .pipe(
                Effect.mapError((cause) => new SmalltalkError({ reason: "invalid_source", cause })),
              );
            excerptQuestion = (
              related.messages.find((row) => row.runId === message.runId)?.text ?? ""
            ).slice(0, 20_000);
            sourceThreadId = visible.sourceThreadId;
            storageMessageId = MessageId.make(
              `excerpt:${source.messageId}:${source.start}:${source.end}`,
            );
          } else {
            sourceThreadId = source.sourceThreadId;
            storageMessageId = source.messageId;
          }
          const existing = yield* sql<{
            id: string;
          }>`SELECT id FROM smalltalk WHERE thread_id = ${input.threadId}
          AND source_thread_id = ${sourceThreadId} AND message_id = ${storageMessageId}`.pipe(
            Effect.mapError(storageError),
          );
          if (existing[0]) {
            const record = yield* get({ threadId: input.threadId, id: existing[0].id });
            if (
              (source.kind === "markdown-file" &&
                record.filePath === source.relativePath &&
                record.sourceText !== source.text) ||
              (source.kind === "highlight-note" &&
                record.sourceKind === "highlight-note" &&
                record.sourceText !== source.text)
            ) {
              const settings = yield* settingsService.getSettings.pipe(
                Effect.mapError((cause) => new SmalltalkError({ reason: "configuration", cause })),
              );
              const active = fibers.get(record.id);
              if (active) {
                fibers.delete(record.id);
                yield* Fiber.interrupt(active);
              }
              return yield* start(
                {
                  ...record,
                  sourceText: source.text,
                  title:
                    source.kind === "markdown-file"
                      ? source.relativePath.slice(0, 100)
                      : plainExcerptTitle(source.text),
                  explanation: "",
                  updatedAt: yield* now,
                },
                settings,
              );
            }
            return record;
          }
          let origin: Pick<Smalltalk, "sourceText" | "question" | "title" | "filePath">;
          let anchor: Smalltalk["anchor"];
          if (source.kind === "markdown-file") {
            origin = {
              sourceText: source.text,
              question: "",
              title: source.relativePath.slice(0, 100),
              filePath: source.relativePath,
            };
            anchor = null;
          } else if (source.kind === "highlight-note") {
            origin = {
              sourceText: source.text,
              question: "",
              title: plainExcerptTitle(source.text),
              filePath: null,
            };
            anchor = null;
          } else if (source.kind === "excerpt") {
            origin = {
              sourceText: source.text,
              question: excerptQuestion,
              title: plainExcerptTitle(source.text),
              filePath: null,
            };
            anchor = {
              text: source.text,
              start: source.start,
              end: source.end,
              prefix: source.prefix,
              suffix: source.suffix,
            };
          } else {
            const projection = yield* threads
              .getThreadProjection(input.threadId)
              .pipe(
                Effect.mapError((cause) => new SmalltalkError({ reason: "invalid_source", cause })),
              );
            const visible = projection.visibleTurnItems.find(
              (entry) =>
                entry.sourceThreadId === source.sourceThreadId &&
                entry.item.type === "assistant_message" &&
                entry.item.messageId === source.messageId &&
                entry.item.status === "completed",
            );
            const records = yield* threads
              .getThreadRecords(source.sourceThreadId, ["messages", "runs"], {
                messageIds: [source.messageId],
              })
              .pipe(
                Effect.mapError((cause) => new SmalltalkError({ reason: "invalid_source", cause })),
              );
            const message = records.messages.find(
              (row) => row.id === source.messageId && row.role === "assistant" && !row.streaming,
            );
            const run = records.runs.find((row) => row.id === message?.runId);
            if (
              !visible ||
              !message ||
              !message.text.trim() ||
              run?.status === "running" ||
              message.text.length > SMALLTALK_SOURCE_TEXT_MAX_LENGTH
            )
              return yield* new SmalltalkError({ reason: "invalid_source" });
            const related = yield* threads
              .getThreadRecords(source.sourceThreadId, ["messages"], {
                messageRoles: ["user"],
                messageRunIds: message.runId === null ? [] : [message.runId],
              })
              .pipe(
                Effect.mapError((cause) => new SmalltalkError({ reason: "invalid_source", cause })),
              );
            const question =
              related.messages.find((row) => row.runId === message.runId)?.text ?? "";
            origin = {
              sourceText: message.text,
              question: question.slice(0, 20_000),
              title: message.text
                .replace(/^\s{0,3}#{1,6}\s+/gm, "")
                .replace(/`/g, "")
                .replace(/\s+/g, " ")
                .slice(0, 100),
              filePath: null,
            };
            anchor = null;
          }
          const timestamp = yield* now;
          const record: Smalltalk = {
            id: yield* random.uuidV4(),
            threadId: input.threadId,
            sourceThreadId,
            messageId: source.kind === "excerpt" ? source.messageId : storageMessageId,
            sourceKind: source.kind,
            anchor,
            ...origin,
            status: "cancelled",
            createdAt: timestamp,
            updatedAt: timestamp,
            explanation: "",
            streamingText: "",
            error: null,
            modelSelection: null,
            requestedModelSelection: null,
            preset: SYSTEM_SMALLTALK_PRESET,
            requestedPreset: SYSTEM_SMALLTALK_PRESET,
            requestId: yield* random.uuidV4(),
          };
          const json = yield* encode(record).pipe(Effect.mapError(storageError));
          yield* sql`INSERT INTO smalltalk (id, thread_id, source_thread_id, message_id, title, status, created_at, updated_at, request_id, payload_json)
          VALUES (${record.id}, ${record.threadId}, ${record.sourceThreadId}, ${storageMessageId}, ${record.title}, ${record.status},
          ${record.createdAt}, ${record.updatedAt}, ${record.requestId}, ${json})`.pipe(
            Effect.mapError(storageError),
          );
          const settings = yield* settingsService.getSettings.pipe(
            Effect.mapError((cause) => new SmalltalkError({ reason: "configuration", cause })),
          );
          return yield* start(record, settings);
        }
        const record = yield* get(input);
        if (input.action === "regenerate") {
          const settings = yield* settingsService.getSettings.pipe(
            Effect.mapError((cause) => new SmalltalkError({ reason: "configuration", cause })),
          );
          return yield* start(record, settings, input.presetId);
        }
        if (input.action === "delete") {
          yield* sql`DELETE FROM smalltalk WHERE id = ${record.id} AND thread_id = ${record.threadId}`.pipe(
            Effect.mapError(storageError),
          );
          yield* notify(record.threadId);
        } else if (record.status === "generating") {
          yield* save(
            {
              ...record,
              requestId: yield* random.uuidV4(),
              status: "cancelled",
              streamingText: "",
              updatedAt: yield* now,
            },
            record.requestId,
          );
        }
        const active = fibers.get(record.id);
        fibers.delete(record.id);
        if (active) yield* Fiber.interrupt(active).pipe(Effect.forkIn(scope));
        return input.action === "delete" ? null : yield* get(input);
      }),
    );
  });
  return SmalltalkService.of({
    get,
    mutate,
    subscribe: ({ threadId }) =>
      SubscriptionRef.changes(revisions).pipe(
        Stream.map((current) => current.get(threadId) ?? 0),
        Stream.changes,
        Stream.mapEffect(() => list(threadId)),
      ),
  });
});
export const layer = Layer.effect(SmalltalkService, make);
