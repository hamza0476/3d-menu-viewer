import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // src/db throws at import time without a DATABASE_URL. Unit tests never
    // query the database; this dummy value only satisfies module loading
    // (the pg Pool does not connect until a query runs).
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db_test",
    },
  },
});
