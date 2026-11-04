import { defineConfig } from "drizzle-kit";

// The database URL comes from the environment only (see .env.example).
// Never commit a real DATABASE_URL to this repository.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in, or export DATABASE_URL before running drizzle-kit."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
