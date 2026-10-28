import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type Schema = typeof schema;

/** Any Drizzle Postgres database (node-postgres in runtime, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** Services accept either a database or an open transaction. */
export type DbOrTx = Db | Tx;

/**
 * Run `fn` inside a transaction. A Tx nests as a savepoint, so services can
 * be composed freely whether the caller already opened a transaction or not.
 */
export function withTx<T>(db: DbOrTx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn as never) as Promise<T>;
}
