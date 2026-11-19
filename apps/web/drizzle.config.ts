import { defineConfig } from "drizzle-kit";

// `pnpm --filter web exec drizzle-kit generate` writes SQL migrations to ./drizzle from the schema.
// `drizzle-kit migrate` applies them and needs DATABASE_URL (use the unpooled Neon URL when there is one).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
