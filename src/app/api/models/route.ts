import { NextResponse } from 'next/server';
import { db } from '@/db';
import { itemModels, modelJobs, products } from '@/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { requireMembership } from '@/lib/tenancy';
import { enqueueModelJob } from '@/lib/model-pipeline';
import { gradeModel } from '@/lib/model-quality';

// 3D Studio data (Phase 4, fixes G4): one entry per menu item — its model
// tracking state, measured quality, variant URLs and the latest job — plus
// a studio summary. Items that never had a model report status 'none'
// (synthesised here; no item_models row exists for them).
const url = (id: string | null) => (id ? '/api/assets/' + id : null);

export async function GET() {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const business = membership.business;

  const items = await db.select().from(products).where(eq(products.businessId, business.id)).orderBy(desc(products.createdAt));
  const itemIds = items.map((i) => i.id);
  const models = itemIds.length ? await db.select().from(itemModels).where(inArray(itemModels.itemId, itemIds)) : [];
  const modelByItem = new Map(models.map((m) => [m.itemId, m]));
  const modelIds = models.map((m) => m.id);
  const jobs = modelIds.length ? await db.select().from(modelJobs).where(inArray(modelJobs.itemModelId, modelIds)).orderBy(desc(modelJobs.createdAt)) : [];
  const lastJobByModel = new Map<string, typeof modelJobs.$inferSelect>();
  for (const j of jobs) if (!lastJobByModel.has(j.itemModelId)) lastJobByModel.set(j.itemModelId, j);

  const entries = items.map((item) => {
    const m = modelByItem.get(item.id) ?? null;
    const job = m ? lastJobByModel.get(m.id) ?? null : null;
    const quality = m && m.status === 'ready'
      ? gradeModel({
          triangleCount: m.triangleCount, sourceBytes: m.sourceBytes, highBytes: m.highBytes, lowBytes: m.lowBytes,
          textureCount: m.textureCount, textureBytes: m.textureBytes,
          hasHigh: !!m.highAssetId, hasLow: !!m.lowAssetId, hasUsdz: !!m.usdzAssetId, hasPoster: !!m.posterAssetId,
          processor: m.processor,
        })
      : null;
    return {
      itemId: item.id,
      name: item.name,
      image: item.image,
      isDeal: item.isDeal,
      hasModel: !!item.model,
      status: m?.status ?? 'none',
      sourceBytes: m?.sourceBytes ?? null,
      highBytes: m?.highBytes ?? null,
      lowBytes: m?.lowBytes ?? null,
      usdzBytes: m?.usdzBytes ?? null,
      triangleCount: m?.triangleCount ?? null,
      textureCount: m?.textureCount ?? null,
      textureBytes: m?.textureBytes ?? null,
      processor: m?.processor ?? null,
      posterStatus: m?.posterStatus ?? null,
      usdzStatus: m?.usdzStatus ?? null,
      errorMessage: m?.errorMessage ?? null,
      processedAt: m?.processedAt ?? null,
      variants: {
        poster: url(m?.posterAssetId ?? null),
        low: url(m?.lowAssetId ?? null),
        high: url(m?.highAssetId ?? null),
        usdz: url(m?.usdzAssetId ?? null),
      },
      quality,
      lastJob: job ? { status: job.status, attempts: job.attempts, error: job.error, createdAt: job.createdAt, finishedAt: job.finishedAt } : null,
    };
  });

  const withModel = entries.filter((e) => e.hasModel);
  const ready = withModel.filter((e) => e.status === 'ready').length;
  return NextResponse.json({
    items: entries,
    summary: {
      totalItems: entries.length,
      withModel: withModel.length,
      ready,
      queuedOrProcessing: withModel.filter((e) => e.status === 'queued' || e.status === 'processing').length,
      failed: withModel.filter((e) => e.status === 'failed').length,
      percentReady: withModel.length ? Math.round((ready / withModel.length) * 100) : 0,
    },
  });
}

// Queue (or re-queue) processing for one item's current model source.
export async function POST(req: Request) {
  const membership = await requireMembership();
  if (!membership) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  if (!itemId) return NextResponse.json({ error: 'Choose a menu item.' }, { status: 400 });
  const result = await enqueueModelJob(membership.business.id, itemId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ itemModel: result.itemModel, job: result.job, created: result.created }, { status: 202 });
}
