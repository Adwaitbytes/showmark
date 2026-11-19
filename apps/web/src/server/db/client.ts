import { neon, neonConfig } from "@neondatabase/serverless";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLWrapper } from "drizzle-orm/sql";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { requireDatabaseUrl } from "../env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A built but not yet executed insert, update or delete. */
export type Statement = BatchItem<"pg"> & SQLWrapper;

export interface Database {
  db: Db;
  /** Runs the statements in order inside one transaction where the driver supports it. */
  batch(statements: Statement[]): Promise<void>;
}

let instance: Database | null = null;

/** No database round trip may hold a page or the relayer longer than this, including a Neon cold start. */
export const DB_TIMEOUT_MS = 5_000;

// Every HTTP query to Neon carries a deadline. A suspended compute usually wakes in well under a second; when it
// does not, the query fails fast with a TimeoutError that callers turn into a typed "database_slow" answer.
neonConfig.fetchFunction = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(DB_TIMEOUT_MS) });

function connectNeon(url: string): Database {
  const db = drizzle({ client: neon(url), schema });
  return {
    db,
    async batch(statements) {
      if (statements.length === 0) return;
      // The Neon HTTP driver has no interactive transactions; batch sends one non-interactive transaction.
      const [first, ...rest] = statements;
      await db.batch([first, ...rest]);
    },
  };
}

/** The shared database handle. Throws AppError(503) when DATABASE_URL is not set. */
export function getDatabase(): Database {
  if (!instance) instance = connectNeon(requireDatabaseUrl());
  return instance;
}

/** Tests inject an in-process Postgres (PGlite) through this. */
export function setDatabase(database: Database | null): void {
  instance = database;
}
