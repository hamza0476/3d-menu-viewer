import { NextResponse } from 'next/server';
import { db } from '@/db';
import { analyticsDaily, guestEvents, products, tables } from '@/db/schema';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { requireMembership, roleAllowed } from '@/lib/tenancy';
import { aggregateEvents, buildAnalyticsSummary, dayKey, dayRange, toCsv } from '@/lib/analytics';

// Dashboard analytics (Phase 3 — fixes G11). Reads the nightly aggregates
// from `analytics_daily` for past days and merges today's raw guest events
// (aggregated in memory with the same rules) so a scan shows up within a
// minute instead of tomorrow. Stored rows FOR today are deliberately
// ignored — raw events are the source of truth for today, which also makes
// the dashboard immune to a same-day rollup having run early.
// `?format=csv` returns the same rows as a server-generated CSV download.
export async function GET(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!roleAllowed(membership.role, 'manager')) return NextResponse.json({ error: 'Analytics are available to owners and managers.' }, { status: 403 });
  const businessId = membership.business.id;
  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get('days') || 30);
  const days = [1, 7, 30, 90].includes(daysParam) ? daysParam : 30;
  const dayList = dayRange(days);
  const today = dayKey(new Date());
  const pastDays = dayList.filter((d) => d !== today);

  const storedRows = pastDays.length
    ? await db.select().from(analyticsDaily).where(and(eq(analyticsDaily.businessId, businessId), inArray(analyticsDaily.day, pastDays)))
    : [];
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const tomorrow = new Date(todayStart.getTime() + 86_400_000);
  const rawToday = await db.select().from(guestEvents)
    .where(and(eq(guestEvents.businessId, businessId), gte(guestEvents.createdAt, todayStart), lt(guestEvents.createdAt, tomorrow)))
    .orderBy(asc(guestEvents.createdAt));
  const todayRows = aggregateEvents(rawToday.map((e) => ({ businessId: e.businessId, type: e.type, tableId: e.tableId, itemId: e.itemId, createdAt: e.createdAt })), today)
    .map((r) => ({ ...r, day: today }));

  if (url.searchParams.get('format') === 'csv') {
    const all = [...storedRows, ...todayRows].sort((a, b) => a.day.localeCompare(b.day) || a.metric.localeCompare(b.metric) || a.dimensionType.localeCompare(b.dimensionType) || a.dimensionId.localeCompare(b.dimensionId));
    const csv = toCsv([['day', 'metric', 'dimension_type', 'dimension_id', 'count'], ...all.map((r) => [r.day, r.metric, r.dimensionType, r.dimensionId, r.count])]);
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="platera-analytics-${days}d.csv"`, 'Cache-Control': 'private, no-store' } });
  }

  const [tableRows, productRows] = await Promise.all([
    db.select().from(tables).where(eq(tables.businessId, businessId)),
    db.select().from(products).where(eq(products.businessId, businessId)),
  ]);
  const summary = buildAnalyticsSummary({
    days: dayList,
    stored: storedRows.map((r) => ({ businessId: r.businessId, day: r.day, metric: r.metric, dimensionType: r.dimensionType as 'all' | 'table' | 'item', dimensionId: r.dimensionId, count: r.count })),
    today: todayRows,
    tableLabels: Object.fromEntries(tableRows.map((t) => [t.id, t.label])),
    itemNames: Object.fromEntries(productRows.map((p) => [p.id, p.name])),
  });
  return NextResponse.json(summary);
}
