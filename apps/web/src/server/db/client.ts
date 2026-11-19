import { neon } from "@neondatabase/serverless";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { requireDatabaseUrl } from "../env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Statement = BatchItem<"pg">;

export interface Database {
  db: Db;
  /** Runs the statements in order inside one transaction where the driver supports it. */
  batch(statements: Statement[]): Promise<void>;
}

let instance: Database | null = null;

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
