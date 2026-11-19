import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "../db/client";
import * as schema from "../db/schema";

/** A real Postgres (PGlite, in process) with the generated migrations applied. Test use only. */
export async function createTestDatabase(): Promise<Database & { close(): Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../drizzle", import.meta.url)) });
  return {
    db,
    async batch(statements) {
      await db.transaction(async (tx) => {
        for (const statement of statements) await tx.execute(statement);
      });
    },
    close: () => client.close(),
  };
}
