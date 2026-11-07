import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE smalltalk (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, source_thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, request_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    UNIQUE(thread_id, source_thread_id, message_id)
  )`;
  yield* sql`CREATE INDEX smalltalk_thread_created ON smalltalk(thread_id, created_at)`;
  yield* sql`CREATE TRIGGER smalltalk_delete_thread AFTER UPDATE OF deleted_at ON orchestration_v2_projection_threads
    WHEN NEW.deleted_at IS NOT NULL BEGIN DELETE FROM smalltalk WHERE thread_id = NEW.thread_id; END`;
  yield* sql`CREATE TRIGGER smalltalk_remove_thread AFTER DELETE ON orchestration_v2_projection_threads
    BEGIN DELETE FROM smalltalk WHERE thread_id = OLD.thread_id; END`;
});
