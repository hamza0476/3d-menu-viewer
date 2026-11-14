// The Phase 4 model pipeline (fixes G4): queue, worker core, processors.
//
// Flow: a menu item's model URL points at a Phase 2 asset (kind
// model-source). enqueueModelJob() records an item_models row + a queued
// model_jobs row. The worker (POST /api/internal/model-worker, driven by
// `npm run models:worker`) claims jobs one at a time and runs
// processClaimedJob(): fetch bytes from Phase 2 storage -> AV hook ->
// deep GLB parse (lib/glb.ts) -> variant production -> bookkeeping.
//
// A corrupt or hostile GLB fails its JOB with a human-readable reason and
// the worker moves on — processClaimedJob never throws.
//
// Variant production is a PLUGGABLE PROCESSOR, honestly labelled:
// - No optimiser configured: the built-in "passthrough" processor stores
//   the source as both the high and low variant. The bytes are real and
//   the viewer can use them, but they are NOT optimised — the item_models
//   row records processor='passthrough' and the owner quality report says
//   exactly that. This exists so the pipeline, tracking, viewer and
//   grades are all real and testable before the deploy environment gets
//   a real optimiser.
// - Optimiser configured (MODEL_OPTIMIZER_HIGH_CMD / _LOW_CMD, or one
//   MODEL_OPTIMIZER_CMD for both): the command is run as an external
//   process with {in}/{out} placeholders (e.g. gltfpack or
//   gltf-transform), and its output must itself parse as a valid GLB
//   before it is stored. processor='external:<first word of the cmd>'.
// - USDZ (MODEL_USDZ_CMD) and poster (MODEL_POSTER_CMD) follow the same
//   adapter rule: with no command configured the status is recorded as
//   'not-configured' — never faked. A command that fails marks that one
//   enhancement 'failed' without failing the whole job (the GLB variants
//   are the product; AR/poster are upgrades), and the failure is visible
//   in the studio UI via the status fields.

import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, itemModels, modelJobs, products } from "@/db/schema";
import { uid } from "@/lib/auth";
import { scanForMalware } from "@/lib/av-scan";
import { parseGlb, type GlbStats } from "@/lib/glb";
import { sha256Hex, validateUpload } from "@/lib/media-validation";
import { storageGet, storagePut } from "@/lib/storage";

type ItemModel = typeof itemModels.$inferSelect;
type ModelJob = typeof modelJobs.$inferSelect;

/** The asset id inside an `/api/assets/<id>` URL, or null. */
export function assetIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^\/api\/assets\/([A-Za-z0-9_-]+)$/);
  return m ? m[1] : null;
}

export type EnqueueResult =
  | { ok: true; itemModel: ItemModel; job: ModelJob; created: boolean }
  | { ok: false; error: string };

/** Record (or refresh) an item's model tracking row and queue a job for
 *  its current model source. Idempotent per (item, source): an identical
 *  in-flight job is returned instead of duplicated. */
export async function enqueueModelJob(businessId: string, itemId: string): Promise<EnqueueResult> {
  const [item] = await db.select().from(products).where(and(eq(products.id, itemId), eq(products.businessId, businessId)));
  if (!item) return { ok: false, error: "Menu item not found." };
  const sourceAssetId = assetIdFromUrl(item.model);
  if (!sourceAssetId) return { ok: false, error: "This item has no uploaded 3D model yet." };
  const [source] = await db.select().from(assets).where(eq(assets.id, sourceAssetId));
  if (!source || source.businessId !== businessId) return { ok: false, error: "The model's source file could not be found." };

  const now = new Date();
  const [existing] = await db.select().from(itemModels).where(eq(itemModels.itemId, itemId));
  let row: ItemModel;
  if (existing) {
    if (existing.sourceAssetId === sourceAssetId && (existing.status === "queued" || existing.status === "processing")) {
      const [job] = await db.select().from(modelJobs)
        .where(and(eq(modelJobs.itemModelId, existing.id), eq(modelJobs.sourceAssetId, sourceAssetId), sql`${modelJobs.status} IN ('queued','processing')`))
        .orderBy(asc(modelJobs.createdAt)).limit(1);
      if (job) return { ok: true, itemModel: existing, job, created: false };
    }
    const [updated] = await db.update(itemModels).set({
      businessId, status: "queued", sourceAssetId, sourceBytes: source.bytes,
      highAssetId: null, lowAssetId: null, usdzAssetId: null, posterAssetId: null,
      highBytes: null, lowBytes: null, usdzBytes: null, triangleCount: null, textureCount: null, textureBytes: null,
      processor: null, posterStatus: null, usdzStatus: null, errorMessage: null, processedAt: null, updatedAt: now,
    }).where(eq(itemModels.id, existing.id)).returning();
    row = updated;
  } else {
    const [inserted] = await db.insert(itemModels).values({
      id: uid(), itemId, businessId, status: "queued", sourceAssetId, sourceBytes: source.bytes,
    }).returning();
    row = inserted;
  }
  const [job] = await db.insert(modelJobs).values({
    id: uid(), itemModelId: row.id, businessId, sourceAssetId, status: "queued",
  }).returning();
  return { ok: true, itemModel: row, job, created: true };
}

/** Remove tracking when an item loses its model entirely. */
export async function clearModelTracking(businessId: string, itemId: string): Promise<void> {
  await db.update(itemModels).set({
    status: "none", sourceAssetId: null, highAssetId: null, lowAssetId: null, usdzAssetId: null, posterAssetId: null,
    sourceBytes: null, highBytes: null, lowBytes: null, usdzBytes: null, triangleCount: null, textureCount: null,
    textureBytes: null, processor: null, posterStatus: null, usdzStatus: null, errorMessage: null, processedAt: null, updatedAt: new Date(),
  }).where(and(eq(itemModels.itemId, itemId), eq(itemModels.businessId, businessId)));
}

// ---------------------------------------------------------------------------
// External processor adapter

const PROCESS_TIMEOUT_MS = 180_000;

function runProcessorCommand(template: string, inPath: string, outPath: string): Promise<void> {
  const command = template.replaceAll("{in}", inPath).replaceAll("{out}", outPath);
  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", command], { timeout: PROCESS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`Processor command failed: ${String(stderr || err.message).slice(0, 300)}`));
      else resolve();
    });
  });
}

async function viaExternalCommand(template: string, inBytes: Buffer, inExt: string, outExt: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "platera-model-"));
  const inPath = path.join(dir, `in.${inExt}`);
  const outPath = path.join(dir, `out.${outExt}`);
  try {
    await fs.writeFile(inPath, inBytes);
    await runProcessorCommand(template, inPath, outPath);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function optimizerFor(variant: "high" | "low"): string | undefined {
  const specific = variant === "high" ? process.env.MODEL_OPTIMIZER_HIGH_CMD : process.env.MODEL_OPTIMIZER_LOW_CMD;
  return specific || process.env.MODEL_OPTIMIZER_CMD || undefined;
}

function processorLabel(template: string | undefined): string {
  if (!template) return "passthrough";
  const firstWord = template.trim().split(/\s+/)[0] ?? "external";
  return `external:${path.basename(firstWord)}`;
}

// ---------------------------------------------------------------------------
// Variant storage

async function storeVariant(opts: {
  ownerId: string;
  businessId: string;
  kind: "model-high" | "model-low" | "model-usdz" | "poster";
  bytes: Buffer;
  ext: string;
  mime: string;
  width?: number | null;
  height?: number | null;
}): Promise<typeof assets.$inferSelect> {
  const id = uid();
  const key = `assets/${opts.ownerId}/${id}.${opts.ext}`;
  await storagePut(key, opts.bytes);
  const [row] = await db.insert(assets).values({
    id, ownerId: opts.ownerId, businessId: opts.businessId, kind: opts.kind, storageKey: key,
    mime: opts.mime, bytes: opts.bytes.length, width: opts.width ?? null, height: opts.height ?? null,
    sha256: sha256Hex(opts.bytes), status: "ready",
  }).returning();
  return row;
}

// ---------------------------------------------------------------------------
// Job processing

async function failJob(job: ModelJob, itemModelId: string, error: string): Promise<void> {
  const now = new Date();
  await db.update(modelJobs).set({ status: "failed", error, finishedAt: now }).where(eq(modelJobs.id, job.id));
  await db.update(itemModels).set({ status: "failed", errorMessage: error.slice(0, 500), updatedAt: now }).where(eq(itemModels.id, itemModelId));
}

export type ProcessOutcome = { jobId: string; status: "done" | "failed"; error?: string };

/** Run one claimed job to completion. Never throws. */
export async function processClaimedJob(job: ModelJob): Promise<ProcessOutcome> {
  try {
    const [model] = await db.select().from(itemModels).where(eq(itemModels.id, job.itemModelId));
    if (!model) { await failJob(job, job.itemModelId, "The tracking row for this model no longer exists."); return { jobId: job.id, status: "failed", error: "missing tracking row" }; }
    if (!job.sourceAssetId) { await failJob(job, model.id, "The job has no source file."); return { jobId: job.id, status: "failed", error: "no source" }; }
    const [source] = await db.select().from(assets).where(eq(assets.id, job.sourceAssetId));
    if (!source) { await failJob(job, model.id, "The source model file could not be found."); return { jobId: job.id, status: "failed", error: "source missing" }; }

    const bytes = await storageGet(source.storageKey);
    if (!bytes) { await failJob(job, model.id, "The source model file is missing from storage."); return { jobId: job.id, status: "failed", error: "storage missing" }; }
    const sourceBytes: Buffer = bytes;

    const scan = await scanForMalware(sourceBytes, "model.glb");
    if (scan.status === "infected") { await failJob(job, model.id, "The source model was rejected by the malware scan."); return { jobId: job.id, status: "failed", error: "infected" }; }
    if (scan.status === "unavailable") { await failJob(job, model.id, "The malware scanner is unavailable, so this model was not processed. It will need a retry once the scanner is back."); return { jobId: job.id, status: "failed", error: "scanner unavailable" }; }

    const parsed = parseGlb(sourceBytes);
    if (!parsed.ok) { await failJob(job, model.id, parsed.error); return { jobId: job.id, status: "failed", error: parsed.error }; }
    const stats: GlbStats = parsed.stats;

    // --- variants ------------------------------------------------------------
    const highTemplate = optimizerFor("high");
    const lowTemplate = optimizerFor("low");
    const label = processorLabel(highTemplate ?? lowTemplate);
    async function produceVariant(template: string | undefined): Promise<Buffer> {
      if (!template) return sourceBytes; // passthrough: a real stored copy, honestly labelled
      const out = await viaExternalCommand(template, sourceBytes, "glb", "glb");
      const check = parseGlb(out);
      if (!check.ok) throw new Error(`The configured optimiser produced an invalid GLB (${check.error})`);
      return out;
    }
    const highBytes = await produceVariant(highTemplate);
    const lowBytes = await produceVariant(lowTemplate);
    const highAsset = await storeVariant({ ownerId: source.ownerId, businessId: model.businessId, kind: "model-high", bytes: highBytes, ext: "glb", mime: "model/gltf-binary" });
    const lowAsset = await storeVariant({ ownerId: source.ownerId, businessId: model.businessId, kind: "model-low", bytes: lowBytes, ext: "glb", mime: "model/gltf-binary" });

    // --- USDZ (optional enhancement; adapter-only) -----------------------------
    let usdzAsset: typeof assets.$inferSelect | null = null;
    let usdzStatus: string;
    const usdzCmd = process.env.MODEL_USDZ_CMD;
    if (!usdzCmd) {
      usdzStatus = "not-configured";
    } else {
      try {
        const out = await viaExternalCommand(usdzCmd, sourceBytes, "glb", "usdz");
        if (out.length === 0) throw new Error("USDZ converter produced an empty file");
        usdzAsset = await storeVariant({ ownerId: source.ownerId, businessId: model.businessId, kind: "model-usdz", bytes: out, ext: "usdz", mime: "model/vnd.usdz+zip" });
        usdzStatus = "ready";
      } catch {
        usdzStatus = "failed";
      }
    }

    // --- poster (optional enhancement; adapter-only) ----------------------------
    let posterAsset: typeof assets.$inferSelect | null = null;
    let posterStatus: string;
    const posterCmd = process.env.MODEL_POSTER_CMD;
    if (!posterCmd) {
      posterStatus = "not-configured";
    } else {
      try {
        const out = await viaExternalCommand(posterCmd, highBytes, "glb", "png");
        const validation = validateUpload(out);
        if (!validation.ok || validation.isModel || !validation.dimensions) throw new Error("Poster renderer did not produce a valid image");
        posterAsset = await storeVariant({ ownerId: source.ownerId, businessId: model.businessId, kind: "poster", bytes: out, ext: "png", mime: validation.mime, width: validation.dimensions.width, height: validation.dimensions.height });
        posterStatus = "ready";
      } catch {
        posterStatus = "failed";
      }
    }

    const now = new Date();
    await db.update(itemModels).set({
      status: "ready", sourceBytes: source.bytes,
      highAssetId: highAsset.id, lowAssetId: lowAsset.id,
      usdzAssetId: usdzAsset?.id ?? null, posterAssetId: posterAsset?.id ?? null,
      highBytes: highBytes.length, lowBytes: lowBytes.length, usdzBytes: usdzAsset ? usdzAsset.bytes : null,
      triangleCount: stats.triangles, textureCount: stats.textureCount, textureBytes: stats.textureBytes,
      processor: label, posterStatus, usdzStatus, errorMessage: null, processedAt: now, updatedAt: now,
    }).where(eq(itemModels.id, model.id));
    await db.update(modelJobs).set({ status: "done", finishedAt: now }).where(eq(modelJobs.id, job.id));
    return { jobId: job.id, status: "done" };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await failJob(job, job.itemModelId, error).catch(() => {});
    return { jobId: job.id, status: "failed", error };
  }
}

const STALE_JOB_MS = 15 * 60 * 1000;

/** Claim and run up to `limit` queued jobs. Returns per-job outcomes.
 *  Jobs stuck in 'processing' for over 15 minutes (a worker died) are
 *  reclaimed to 'queued' first. */
export async function processModelJobs(limit = 5): Promise<ProcessOutcome[]> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);
  await db.update(modelJobs).set({ status: "queued", startedAt: null })
    .where(and(eq(modelJobs.status, "processing"), lt(modelJobs.startedAt, staleBefore)));

  const outcomes: ProcessOutcome[] = [];
  for (let i = 0; i < limit; i++) {
    const [claimed] = await db.update(modelJobs)
      .set({ status: "processing", startedAt: new Date(), attempts: sql`${modelJobs.attempts} + 1` })
      .where(sql`${modelJobs.id} = (SELECT id FROM model_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1)`)
      .returning();
    if (!claimed) break;
    await db.update(itemModels).set({ status: "processing", updatedAt: new Date() }).where(eq(itemModels.id, claimed.itemModelId));
    outcomes.push(await processClaimedJob(claimed));
  }
  return outcomes;
}
