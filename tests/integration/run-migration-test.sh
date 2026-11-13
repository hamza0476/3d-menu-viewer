#!/usr/bin/env bash
# Prepares a LEGACY (Phase 1 baseline-only) database and a production build,
# then runs tests/integration/assets-migration.mjs, which drives the whole
# Phase 2 legacy-upgrade sequence itself.
#
# Usage: tests/integration/run-migration-test.sh
# Requires: a reachable PostgreSQL (TEST_PG_BASE, default as in run.sh).
set -euo pipefail

NAME="platera_test_assets_migration"
BASE_URL="${TEST_PG_BASE:-postgresql://postgres:postgres@127.0.0.1:5432}"
export PGDATABASE_URL="$BASE_URL/$NAME"
export ASSET_STORAGE_DIR="${ASSET_STORAGE_DIR:-/tmp/platera-migration-storage}"
export MIGRATION_REPORT="${MIGRATION_REPORT:-/tmp/platera-migration-report.json}"
export ASSET_SIGNING_SECRET="${ASSET_SIGNING_SECRET:-test-signing-secret}"

cd "$(dirname "$0")/../.."

psql "$BASE_URL/postgres" -qc "DROP DATABASE IF EXISTS $NAME;" -qc "CREATE DATABASE $NAME;"
rm -rf "$ASSET_STORAGE_DIR" "$MIGRATION_REPORT"

# Build a baseline-only drizzle folder so `drizzle-kit migrate` creates a
# genuine Phase 1 database (journal included), not a hand-rolled copy.
LEGACY_DIR="$(mktemp -d)"
mkdir -p "$LEGACY_DIR/meta"
cp drizzle/0000_baseline.sql "$LEGACY_DIR/"
cp drizzle/meta/0000_snapshot.json "$LEGACY_DIR/meta/"
node -e "
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8'));
j.entries = j.entries.filter((e) => e.idx === 0);
fs.writeFileSync('$LEGACY_DIR/meta/_journal.json', JSON.stringify(j, null, 2));
"
cat > drizzle.legacy.config.ts <<EOF
import { defineConfig } from "drizzle-kit";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
export default defineConfig({ schema: "./src/db/schema.ts", out: "$LEGACY_DIR", dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL } });
EOF
trap 'rm -f drizzle.legacy.config.ts; rm -rf "$LEGACY_DIR"' EXIT

DATABASE_URL="$PGDATABASE_URL" npx drizzle-kit migrate --config=drizzle.legacy.config.ts >/dev/null

npm run build >/dev/null

DATABASE_URL="$PGDATABASE_URL" node tests/integration/assets-migration.mjs
