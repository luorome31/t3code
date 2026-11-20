import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import Smalltalk from "./Migrations/Smalltalk.ts";

const legacyIds = [81, 92] as const;
const forkLedger = "t3_fork_migrations";
const smalltalkMigration = { id: 1, name: "Smalltalk" } as const;

export function reconciledSmalltalkHistory(
  history: ReadonlyArray<{ readonly id: number; readonly name: string }>,
) {
  const tip = history.at(-1);
  return tip?.name === smalltalkMigration.name && legacyIds.some((id) => id === tip.id)
    ? history.slice(0, -1)
    : history;
}

export const reconcileSmalltalkMigration = Effect.fn("reconcileSmalltalkMigration")(function* (
  throughId?: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;

  // Older fork builds placed Smalltalk at the end of the upstream ledger.
  yield* sql`
    DELETE FROM effect_sql_migrations
    WHERE name = ${smalltalkMigration.name}
      AND migration_id IN ${sql.in(legacyIds)}
      AND migration_id <= ${throughId ?? Number.MAX_SAFE_INTEGER}
      AND migration_id = (SELECT MAX(migration_id) FROM effect_sql_migrations)
  `;
});

export const hasPendingSmalltalkMigration = Effect.fn("hasPendingSmalltalkMigration")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${forkLedger}
  `;
  if (tables.length === 0) return true;
  const rows = yield* sql`
    SELECT migration_id FROM ${sql(forkLedger)}
    WHERE migration_id = ${smalltalkMigration.id} AND name = ${smalltalkMigration.name}
  `;
  return rows.length === 0;
});

export const runSmalltalkMigration = Migrator.make({})({
  table: forkLedger,
  loader: Migrator.fromRecord({
    [`${smalltalkMigration.id}_${smalltalkMigration.name}`]: Smalltalk,
  }),
});
