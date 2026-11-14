// Nightly analytics rollup (Phase 3 — fixes G11).
//
//   npm run analytics:rollup                 # rolls up YESTERDAY (UTC)
//   npm run analytics:rollup -- --day=2026-11-12
//   npm run analytics:rollup -- --days=7     # the last 7 days ending yesterday
//
// Folds one UTC day of raw `guest_events` into `analytics_daily` — one row
// per (business, day, metric, dimension: all/table/item) — using the same
// counting rules as src/lib/analytics.ts (aggregateEvents). The day's
// existing aggregate rows are deleted and recomputed inside one
// transaction, so re-running a day is idempotent and can never
// double-count. Schedule it nightly (cron / platform scheduler); it is a
// plain script on purpose — no scheduler is embedded in the app.
//
// Day boundaries are UTC: created_at is a naive timestamp and the database
// is expected to run in UTC (Neon's default; the local docker-compose /
// apt Postgres in this repo's test setup also runs UTC).
import { randomBytes } from "crypto";
import pg from "pg";

const uid = () => randomBytes(12).toString("hex");
const dayKey = (d) => d.toISOString().slice(0, 10);

function targetDays() {
  const args = process.argv.slice(2);
  const dayArg = args.find((a) => a.startsWith("--day="))?.slice(6);
  const daysArg = Number(args.find((a) => a.startsWith("--days="))?.slice(7) || 0);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (dayArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayArg)) throw new Error(`--day must be YYYY-MM-DD, got "${dayArg}"`);
    return [dayArg];
  }
  const n = daysArg > 0 ? Math.min(daysArg, 366) : 1;
  return Array.from({ length: n }, (_, i) => dayKey(new Date(today.getTime() - (n - i) * 86_400_000)));
}

const AGGREGATES_SQL = `
  SELECT business_id, type AS metric, 'all' AS dimension_type, '' AS dimension_id, count(*)::int AS count
    FROM guest_events WHERE created_at >= $1::date AND created_at < $1::date + 1 GROUP BY 1, 2
  UNION ALL
  SELECT business_id, type, 'table', table_id, count(*)::int
    FROM guest_events WHERE created_at >= $1::date AND created_at < $1::date + 1 AND table_id IS NOT NULL GROUP BY 1, 2, 4
  UNION ALL
  SELECT business_id, type, 'item', item_id, count(*)::int
    FROM guest_events WHERE created_at >= $1::date AND created_at < $1::date + 1 AND item_id IS NOT NULL GROUP BY 1, 2, 4`;

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }
const pool = new pg.Pool({ connectionString: url });

for (const day of targetDays()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(AGGREGATES_SQL, [day]);
    await client.query("DELETE FROM analytics_daily WHERE day = $1::date", [day]);
    for (const r of rows) {
      await client.query(
        "INSERT INTO analytics_daily (id, business_id, day, metric, dimension_type, dimension_id, count) VALUES ($1, $2, $3::date, $4, $5, $6, $7)",
        [uid(), r.business_id, day, r.metric, r.dimension_type, r.dimension_id, r.count],
      );
    }
    await client.query("COMMIT");
    const businesses = new Set(rows.map((r) => r.business_id)).size;
    console.log(`analytics rollup: day=${day} businesses=${businesses} rows=${rows.length}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`analytics rollup FAILED for day=${day}:`, e);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}
await pool.end();
