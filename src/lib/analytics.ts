// Analytics aggregation (Phase 3 — fixes G11).
//
// Raw guest events land in `guest_events`. A nightly rollup
// (scripts/rollup-analytics.mjs) folds one UTC day of raw events into
// `analytics_daily` — one row per (business, day, metric, dimension) — and
// the dashboard reads those aggregates. Today is never rolled up yet, so the
// dashboard merges today's raw events (aggregated in memory with the exact
// same rules) on top of the stored aggregates: an event shows in analytics
// immediately, and in the permanent aggregates after the nightly run.
//
// All day boundaries are UTC. (Per-restaurant timezones are a Phase 6
// concern; UTC is stated plainly rather than silently assumed.)

export type RawEvent = {
  businessId: string;
  type: string;
  tableId?: string | null;
  itemId?: string | null;
  createdAt: Date;
};

export type AggregateRow = {
  businessId: string;
  day: string;
  metric: string;
  dimensionType: "all" | "table" | "item";
  dimensionId: string;
  count: number;
};

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

// The last `days` UTC day keys, oldest first, ending today.
export function dayRange(days: number, now = new Date()): string[] {
  const out: string[] = [];
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(new Date(today.getTime() - i * 86_400_000)));
  return out;
}

// Fold raw events of one UTC day into aggregate rows. Every event counts
// once toward 'all', once toward its table (when attributed) and once toward
// its item (when it has one). Events from other days are ignored, so the
// caller can hand over a superset safely.
export function aggregateEvents(events: RawEvent[], day: string): AggregateRow[] {
  const counts = new Map<string, AggregateRow>();
  const add = (businessId: string, metric: string, dimensionType: AggregateRow["dimensionType"], dimensionId: string) => {
    const key = [businessId, metric, dimensionType, dimensionId].join("|");
    const row = counts.get(key);
    if (row) row.count += 1;
    else counts.set(key, { businessId, day, metric, dimensionType, dimensionId, count: 1 });
  };
  for (const e of events) {
    if (dayKey(e.createdAt) !== day) continue;
    add(e.businessId, e.type, "all", "");
    if (e.tableId) add(e.businessId, e.type, "table", e.tableId);
    if (e.itemId) add(e.businessId, e.type, "item", e.itemId);
  }
  return [...counts.values()].sort((a, b) => a.metric.localeCompare(b.metric) || a.dimensionType.localeCompare(b.dimensionType) || a.dimensionId.localeCompare(b.dimensionId));
}

export type AnalyticsSummary = {
  days: string[];
  totals: Record<string, number>;
  byDay: { day: string; counts: Record<string, number> }[];
  byTable: { id: string; label: string; counts: Record<string, number>; total: number }[];
  byItem: { id: string; name: string; counts: Record<string, number>; total: number }[];
};

// Merge stored aggregate rows (past days) with today's in-memory rows into
// the shape the dashboard renders. `labels` maps dimension ids to display
// names (table labels / dish names); unknown ids fall back to the id.
export function buildAnalyticsSummary(opts: {
  stored: AggregateRow[];
  today: AggregateRow[];
  days: string[];
  tableLabels?: Record<string, string>;
  itemNames?: Record<string, string>;
}): AnalyticsSummary {
  const rows = [...opts.stored, ...opts.today].filter((r) => opts.days.includes(r.day));
  const bump = (rec: Record<string, number>, metric: string, n: number) => { rec[metric] = (rec[metric] || 0) + n; };

  const totals: Record<string, number> = {};
  const byDayMap = new Map<string, Record<string, number>>(opts.days.map((d) => [d, {}]));
  const tableMap = new Map<string, { counts: Record<string, number>; total: number }>();
  const itemMap = new Map<string, { counts: Record<string, number>; total: number }>();

  for (const r of rows) {
    if (r.dimensionType === "all") {
      bump(totals, r.metric, r.count);
      const dayCounts = byDayMap.get(r.day);
      if (dayCounts) bump(dayCounts, r.metric, r.count);
    } else {
      const map = r.dimensionType === "table" ? tableMap : itemMap;
      const entry = map.get(r.dimensionId) || { counts: {}, total: 0 };
      bump(entry.counts, r.metric, r.count);
      entry.total += r.count;
      map.set(r.dimensionId, entry);
    }
  }

  const byTable = [...tableMap.entries()]
    .map(([id, v]) => ({ id, label: opts.tableLabels?.[id] || id, counts: v.counts, total: v.total }))
    .sort((a, b) => b.total - a.total);
  const byItem = [...itemMap.entries()]
    .map(([id, v]) => ({ id, name: opts.itemNames?.[id] || id, counts: v.counts, total: v.total }))
    .sort((a, b) => b.total - a.total);
  return { days: opts.days, totals, byDay: opts.days.map((day) => ({ day, counts: byDayMap.get(day) || {} })), byTable, byItem };
}

// Minimal RFC-4180 CSV: quote when the value contains a comma, quote or
// newline; double internal quotes.
export function toCsv(rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
