import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { it, assert } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  MessageId,
  ThreadId,
  ProjectId,
  ProviderInstanceId,
  SYSTEM_SMALLTALK_PRESET,
  TextGenerationError,
  type Smalltalk,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as SmalltalkService from "./SmalltalkService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Settings from "../serverSettings.ts";
import migration from "../persistence/Migrations/081_Smalltalk.ts";

const threadId = ThreadId.make("thread");
const otherThreadId = ThreadId.make("other");
const messageId = MessageId.make("answer");
const secondMessageId = MessageId.make("answer-2");
const selection = { instanceId: ProviderInstanceId.make("codex"), model: "test-model" };
const create = { action: "create" as const, threadId, sourceThreadId: threadId, messageId };
const custom = { id: "custom", name: "Example", prompt: "Explain with an example." };

const fixture = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, deleted_at TEXT)`;
  yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id) VALUES (${threadId}), (${otherThreadId})`;
  yield* migration;
  const settings = yield* Ref.make({
    ...DEFAULT_SERVER_SETTINGS,
    smalltalkModelSelection: selection,
    smalltalkPresets: [custom],
  });
  type Job = {
    gate: Deferred.Deferred<string, TextGenerationError>;
    instructions: string;
    sourceText: string;
  };
  const jobs = yield* Queue.unbounded<Job>();
  const projection = {
    thread: { id: threadId, projectId: ProjectId.make("project") },
    messages: [
      {
        id: messageId,
        role: "assistant",
        text: "A transaction commits all changes atomically.",
        streaming: false,
        runId: "run",
      },
      {
        id: secondMessageId,
        role: "assistant",
        text: "A cache stores earlier results.",
        streaming: false,
        runId: "run",
      },
    ],
    runs: [{ id: "run", status: "completed" }],
    visibleTurnItems: [
      {
        sourceThreadId: threadId,
        item: { type: "assistant_message", messageId, status: "completed" },
      },
      {
        sourceThreadId: threadId,
        item: { type: "assistant_message", messageId: secondMessageId, status: "completed" },
      },
    ],
  };
  const layer = SmalltalkService.layer.pipe(
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadProjection: () =>
          Effect.succeed(
            projection as unknown as Awaited<
              Effect.Success<
                ReturnType<
                  ThreadManagement.ThreadManagementService["Service"]["getThreadProjection"]
                >
              >
            >,
          ),
        getThreadRecords: () =>
          Effect.succeed(
            projection as unknown as Effect.Success<
              ReturnType<ThreadManagement.ThreadManagementService["Service"]["getThreadRecords"]>
            >,
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProviderRegistry.ProviderInstanceRegistry)({
        getInstance: () =>
          Effect.succeed({
            driverKind: "codex",
            snapshot: {
              getSnapshot: Effect.succeed({
                enabled: true,
                installed: true,
                status: "ready",
                auth: { status: "authenticated" },
              } as ServerProvider),
            },
          } as unknown as NonNullable<
            Effect.Success<
              ReturnType<ProviderRegistry.ProviderInstanceRegistry["Service"]["getInstance"]>
            >
          >),
      }),
    ),
    Layer.provide(Layer.mock(Settings.ServerSettingsService)({ getSettings: Ref.get(settings) })),
    Layer.provide(
      Layer.mock(TextGeneration.TextGeneration)({
        generateSmalltalk: (input) =>
          Effect.gen(function* () {
            const gate = yield* Deferred.make<string, TextGenerationError>();
            yield* Queue.offer(jobs, {
              gate,
              instructions: input.instructions,
              sourceText: input.sourceText,
            });
            const explanation = yield* Deferred.await(gate);
            return {
              explanation,
              modelSelection: { ...input.modelSelection, model: "actual-model" },
            };
          }),
      }),
    ),
  );
  return { layer, settings, jobs, sql };
});
const database = NodeSqliteClient.layer({ filename: ":memory:" });
const dependencies = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);
const settled = (
  service: SmalltalkService.SmalltalkService["Service"],
  id: string,
  status: Smalltalk["status"],
) =>
  service.subscribe({ threadId }).pipe(
    Stream.filter((rows) => rows.some((row) => row.id === id && row.status === status)),
    Stream.runHead,
  );

it.effect(
  "reuses each source, persists results and provenance, and preserves a successful result when regeneration fails",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* Effect.gen(function* () {
          const service = yield* SmalltalkService.SmalltalkService;
          const first = yield* service.mutate(create);
          assert.isNotNull(first);
          const record = first!;
          const job = yield* Queue.take(f.jobs);
          assert.strictEqual(job.sourceText, "A transaction commits all changes atomically.");
          assert.strictEqual(job.instructions, SYSTEM_SMALLTALK_PRESET.prompt);
          assert.strictEqual((yield* service.mutate(create))?.id, record.id);
          assert.strictEqual(yield* Queue.size(f.jobs), 0);
          yield* Deferred.succeed(job.gate, "All changes are saved together, or none are.");
          yield* settled(service, record.id, "completed");
          const result = yield* service.get(record);
          assert.strictEqual(result.modelSelection?.model, "actual-model");
          assert.strictEqual(result.explanation, "All changes are saved together, or none are.");
          yield* Ref.update(f.settings, (settings) => ({
            ...settings,
            smalltalkDefaultPresetId: custom.id,
          }));
          assert.strictEqual((yield* service.get(record)).preset.id, "system");
          yield* service.mutate({ action: "regenerate", threadId, id: record.id });
          const retry = yield* Queue.take(f.jobs);
          assert.strictEqual(retry.instructions, custom.prompt);
          yield* Deferred.fail(
            retry.gate,
            new TextGenerationError({ operation: "generateSmalltalk", detail: "test" }),
          );
          yield* settled(service, record.id, "failed");
          const failed = yield* service.get(record);
          assert.strictEqual(failed.explanation, result.explanation);
          assert.strictEqual(failed.preset.id, "system");
          assert.strictEqual(failed.requestedPreset.id, custom.id);
          const crossThread = yield* Effect.result(
            service.get({ threadId: otherThreadId, id: record.id }),
          );
          assert.strictEqual(crossThread._tag, "Failure");
          const second = (yield* service.mutate({ ...create, messageId: secondMessageId }))!;
          yield* Queue.take(f.jobs);
          assert.notStrictEqual(second.id, record.id);
          const rows = Option.getOrThrow(
            yield* service.subscribe({ threadId }).pipe(Stream.runHead),
          );
          assert.strictEqual(rows.length, 2);
          yield* service.mutate({ action: "cancel", threadId, id: second.id });
          yield* Ref.update(f.settings, (settings) => ({
            ...settings,
            projectSettingsOverrides: {
              [ProjectId.make("project")]: {
                providerInstances: { [selection.instanceId]: { enabled: false } },
              },
            },
          }));
          const unavailable = yield* service.mutate({
            action: "regenerate",
            threadId,
            id: record.id,
          });
          assert.strictEqual(unavailable?.status, "failed");
          assert.strictEqual(yield* Queue.size(f.jobs), 0);
        }).pipe(Effect.provide(f.layer));
      }),
    ).pipe(Effect.provide(database.pipe(Layer.provideMerge(dependencies)))),
);

it.effect(
  "cancels and deletes pending requests without resurrecting records, and rejects unrelated source answers",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* Effect.gen(function* () {
          const service = yield* SmalltalkService.SmalltalkService;
          const invalid = yield* service
            .mutate({ ...create, sourceThreadId: otherThreadId })
            .pipe(Effect.flip);
          assert.strictEqual(invalid.reason, "invalid_source");
          const record = (yield* service.mutate(create))!;
          const job = yield* Queue.take(f.jobs);
          yield* service.mutate({ action: "cancel", threadId, id: record.id });
          yield* Deferred.succeed(job.gate, "Too late");
          assert.strictEqual((yield* service.get(record)).status, "cancelled");
          yield* service.mutate({ action: "regenerate", threadId, id: record.id });
          const second = yield* Queue.take(f.jobs);
          yield* service.mutate({ action: "delete", threadId, id: record.id });
          yield* Deferred.succeed(second.gate, "Also too late");
          assert.deepStrictEqual(
            Option.getOrThrow(yield* service.subscribe({ threadId }).pipe(Stream.runHead)),
            [],
          );
          assert.strictEqual((yield* service.get(record).pipe(Effect.flip)).reason, "not_found");
        }).pipe(Effect.provide(f.layer));
      }),
    ).pipe(Effect.provide(database.pipe(Layer.provideMerge(dependencies)))),
);

it.effect(
  "recovers interrupted requests on restart and removes data when their owning thread is deleted",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const record = yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* SmalltalkService.SmalltalkService;
            const record = (yield* service.mutate(create))!;
            yield* Queue.take(f.jobs);
            return record;
          }).pipe(Effect.provide(f.layer)),
        );
        yield* Effect.gen(function* () {
          const service = yield* SmalltalkService.SmalltalkService;
          assert.strictEqual((yield* service.get(record)).status, "failed");
          yield* f.sql`UPDATE orchestration_v2_projection_threads SET deleted_at = 'deleted' WHERE thread_id = ${threadId}`;
          assert.deepStrictEqual(yield* f.sql`SELECT id FROM smalltalk`, []);
        }).pipe(Effect.provide(f.layer));
      }),
    ).pipe(Effect.provide(database.pipe(Layer.provideMerge(dependencies)))),
);
