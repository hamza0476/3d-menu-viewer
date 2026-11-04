#!/usr/bin/env bash
# Runs one HTTP integration script against a FRESH database + production build.
# Usage: tests/integration/run.sh <script.mjs> [port]
# Requires: a reachable PostgreSQL (DATABASE_URL base taken from .env or env),
# with permission to drop/create the test database named platera_test_<script>.
set -euo pipefail

SCRIPT="${1:?usage: run.sh <script.mjs> [port]}"
PORT="${2:-3100}"
NAME="platera_test_$(basename "$SCRIPT" .mjs | tr '-' '_')"
BASE_URL="${TEST_PG_BASE:-postgresql://postgres:postgres@127.0.0.1:5432}"
export DATABASE_URL="$BASE_URL/$NAME"
LOG="/tmp/platera-integration-$NAME.log"

cd "$(dirname "$0")/../.."

# Fresh database, migrated from the versioned migrations (never db:push).
psql "$BASE_URL/postgres" -qc "DROP DATABASE IF EXISTS $NAME;" -qc "CREATE DATABASE $NAME;"
npx drizzle-kit migrate >/dev/null

npm run build >/dev/null
(npx next start -p "$PORT" >"$LOG" 2>&1 &)
SERVER_PID=""
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

cleanup() {
  for pid in $(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

BASE="http://127.0.0.1:$PORT" PGDATABASE_URL="$DATABASE_URL" SERVER_LOG="$LOG" node "tests/integration/$SCRIPT"
