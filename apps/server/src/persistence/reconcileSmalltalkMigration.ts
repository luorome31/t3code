import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Fork builds recorded the Smalltalk table at id 81, which main uses for
 * ProjectionMessageSearchText. Free the id so 81..91 can run; 92 recreates the table only when
 * it is missing.
 */
export const reconcileSmalltalkMigration = Effect.fn("reconcileSmalltalkMigration")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;
  yield* sql`
    DELETE FROM effect_sql_migrations WHERE migration_id = 81 AND name = 'Smalltalk'
  `;
});
