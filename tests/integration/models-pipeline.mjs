// HTTP-level integration tests for Phase 4 (3D pipeline & viewer):
// upload -> auto-enqueue -> worker -> variants/bookkeeping, the deep GLB
// gate (corrupt JSON, over-limit triangle counts, truncated upload), the
// worker endpoint's secret gate + the models:worker CLI, retry, tenant
// isolation, published-only variant access, the guest payload's model3d
// bundle, and 3d_open events.
//
// Two modes (env MODE):
//   default — no processor commands configured: honest passthrough
//             variants, poster/USDZ report 'not-configured'.
//   tools   — MODEL_OPTIMIZER_CMD / MODEL_POSTER_CMD / MODEL_USDZ_CMD
//             point at real external commands (test fixtures + the
//             repo's Playwright poster renderer): variants must differ
//             from the source, poster must be a real 640x640 PNG asset,
//             USDZ must be a stored model-usdz asset.
// Run via:
//   MODEL_WORKER_SECRET=<redacted> bash tests/integration/run.sh models-pipeline.mjs
//   MODE=tools MODEL_WORKER_SECRET=... MODEL_OPTIMIZER_CMD="node tests/fixtures/fake-optimizer.mjs {in} {out}" \
//     MODEL_USDZ_CMD="node tests/fixtures/fake-usdz.mjs {in} {out}" \
//     MODEL_POSTER_CMD="node scripts/render-poster.mjs {in} {out}" \
//     bash tests/integration/run.sh models-pipeline.mjs
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";
import pg from "pg";

const run = promisify(execFile);
const BASE = process.env.BASE || "http://127.0.0.1:3100";
const DB = process.env.PGDATABASE_URL;
const SECRET = process.env.MODEL_WORKER_SECRET || "test-worker-secret";
const TOOLS = process.env.MODE === "tools";
if (!DB) { console.error("PGDATABASE_URL is required"); process.exit(2); }

let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failures++;
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// --- GLB fixtures -------------------------------------------------------------
function chunk(type, data, padByte) {
  const pad = (4 - (data.length % 4)) % 4;
  const out = Buffer.alloc(8 + data.length + pad, padByte);
  out.writeUInt32LE(data.length + pad, 0);
  out.writeUInt32LE(type, 4);
  data.copy(out, 8);
  return out;
}
function assembleGlb(jsonObj, bin) {
  const body = Buffer.concat([chunk(0x4e4f534a, Buffer.from(JSON.stringify(jsonObj)), 0x20), chunk(0x004e4942, bin, 0)]);
  const head = Buffer.alloc(12);
  head.write("glTF", 0, "latin1");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}
function triangleGlb({ textured = false } = {}) {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const normals = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer);
  const indices = Buffer.from(new Uint16Array([0, 1, 2]).buffer);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");
  const parts = [positions, normals, indices];
  if (textured) parts.push(png);
  const bin = Buffer.concat(parts);
  const views = [
    { buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 36 },
    { buffer: 0, byteOffset: 72, byteLength: 6 },
  ];
  if (textured) views.push({ buffer: 0, byteOffset: 78, byteLength: png.length });
  const json = {
    asset: { version: "2.0", generator: "platera-test" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [textured ? { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } : { pbrMetallicRoughness: { baseColorFactor: [0.85, 0.2, 0.2, 1] } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, type: "VEC3", count: 3, min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, type: "VEC3", count: 3 },
      { bufferView: 2, componentType: 5123, type: "SCALAR", count: 3 },
    ],
    ...(textured ? { images: [{ bufferView: 3, mimeType: "image/png" }], textures: [{ source: 0 }] } : {}),
  };
  return assembleGlb(json, bin);
}
function corruptJsonGlb() {
  const jsonBuf = Buffer.from("{ this is not the glTF you are looking for", "utf8");
  const body = Buffer.concat([chunk(0x4e4f534a, jsonBuf, 0x20), chunk(0x004e4942, Buffer.alloc(64), 0)]);
  const head = Buffer.alloc(12);
  head.write("glTF", 0, "latin1");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}
function hugeTriangleGlb() {
  // Declared counts claim >5M triangles; the BIN must really back the
  // declared buffer (the parser checks), so this is a ~36MB file — it is
  // placed in storage directly (below), never uploaded over HTTP.
  const bin = Buffer.alloc(36 * 1024 * 1024);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5125, type: "SCALAR", count: 15_000_003 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 0 }] }],
  };
  // POSITION pointing at a SCALAR accessor is wrong on purpose? No — use a
  // dedicated VEC3 accessor with matching huge count and indexed triangles.
  json.accessors = [
    { bufferView: 0, componentType: 5126, type: "VEC3", count: 3 },
    { bufferView: 0, componentType: 5125, type: "SCALAR", count: 15_000_003 },
  ];
  json.meshes[0].primitives[0].indices = 1;
  return assembleGlb(json, bin);
}

// --- HTTP helpers ---------------------------------------------------------------
function cookieOf(res) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of cookies) { const m = c.match(/platera_session=([^;]+)/); if (m) return m[1]; }
  return null;
}
async function api(pathname, { method = "GET", body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), Origin: BASE, ...(cookie ? { Cookie: `platera_session=${cookie}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { res, status: res.status, json, buf, cookie: cookieOf(res) };
}
async function upload(cookie, bytes, name = "model.glb") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "model/gltf-binary" }), name);
  const res = await fetch(BASE + "/api/assets", { method: "POST", headers: { Origin: BASE, Cookie: `platera_session=${cookie}` }, body: form });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
async function worker(cookieSecret, limit = 10) {
  return api("/api/internal/model-worker", { method: "POST", body: { limit }, headers: { "x-model-worker-secret": cookieSecret } });
}

const pool = new pg.Pool({ connectionString: DB });
const stamp = Date.now();
const regA = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner A", email: `a-${stamp}@example.com`, password: `A-owner-${stamp}-pass!`, businessName: "A's Place" } });
const cookieA = regA.cookie;
check("owner A registers", regA.json?.ok === true && !!cookieA);
const regB = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner B", email: `b-${stamp}@example.com`, password: `B-owner-${stamp}-pass!`, businessName: "B's Place" } });
const cookieB = regB.cookie;
check("owner B registers", regB.json?.ok === true && !!cookieB);
const wsA = await api("/api/workspace", { cookie: cookieA });
const businessA = wsA.json?.business?.id;
const wsB = await api("/api/workspace", { cookie: cookieB });
const businessB = wsB.json?.business?.id;
check("workspaces load", !!businessA && !!businessB);

const modelRow = async (itemId) => (await pool.query("SELECT * FROM item_models WHERE item_id = $1", [itemId])).rows[0] ?? null;
const jobRows = async (itemModelId) => (await pool.query("SELECT * FROM model_jobs WHERE item_model_id = $1 ORDER BY created_at", [itemModelId])).rows;
async function makeItem(cookie, name, modelUrl) {
  const r = await api("/api/products", { method: "POST", cookie, body: { name, description: `${name} description`, price: 1200, category: "Main courses", image: "", model: modelUrl, tags: [], photos: [], available: true } });
  return r.json;
}

// --- Happy path: textured model, auto-enqueue on product save -------------------
const validBytes = triangleGlb({ textured: true });
const up1 = await upload(cookieA, validBytes);
check("valid textured GLB uploads as model-source", up1.status === 200 && up1.json?.kind === "model-source" && !!up1.json?.url);
const item1 = await makeItem(cookieA, "Textured Dish", up1.json.url);
check("product with a model is created", !!item1?.id);
const row1 = await modelRow(item1.id);
check("saving the product auto-queued a pipeline job", !!row1 && row1.status === "queued");
const jobs1 = await jobRows(row1.id);
check("exactly one queued job exists", jobs1.length === 1 && jobs1[0].status === "queued");

const studio1 = await api("/api/models", { cookie: cookieA });
const entry1 = studio1.json?.items?.find((i) => i.itemId === item1.id);
check("studio API lists the item as queued with no quality yet", !!entry1 && entry1.status === "queued" && entry1.quality === null && studio1.json.summary.withModel >= 1);

// --- Worker gates -----------------------------------------------------------------
check("worker endpoint without secret -> 404", (await api("/api/internal/model-worker", { method: "POST", body: {} })).status === 404);
check("worker endpoint with wrong secret -> 404", (await worker("wrong-secret")).status === 404);
const anonStudio = await api("/api/models");
check("studio API unauthenticated -> 401", anonStudio.status === 401);

// --- Run the worker through the real CLI script ------------------------------------
const cli = await run("node", ["scripts/process-models.mjs"], { cwd: process.cwd(), env: { ...process.env, APP_URL: BASE, MODEL_WORKER_SECRET: SECRET } });
check("models:worker CLI processes the queue and exits 0", /processed=1/.test(cli.stdout) && /done=1/.test(cli.stdout));

const row1b = await modelRow(item1.id);
check("item is ready after the worker run", row1b?.status === "ready" && !!row1b.processed_at);
check("measured stats recorded (1 triangle, 1 texture)", row1b.triangle_count === 1 && row1b.texture_count === 1 && row1b.texture_bytes > 0);
const jobs1b = await jobRows(row1.id);
check("job marked done with one attempt", jobs1b.length === 1 && jobs1b[0].status === "done" && jobs1b[0].attempts === 1);

const variantRows = (await pool.query("SELECT * FROM assets WHERE id = ANY($1)", [[row1b.high_asset_id, row1b.low_asset_id]])).rows;
check("high + low variant assets exist with the right kinds", variantRows.length === 2 && variantRows.every((r) => r.kind === "model-high" || r.kind === "model-low"));
if (TOOLS) {
  check("processor is the configured external tool", /^external:/.test(row1b.processor ?? ""));
  const lowBytesStored = await fs.readFile(path.join(process.cwd(), ".storage", variantRows.find((r) => r.kind === "model-low").storage_key));
  check("optimiser output really differs from the source (adapter ran)", sha256(lowBytesStored) !== sha256(validBytes) && lowBytesStored.length !== 0);
  check("poster is ready", row1b.poster_status === "ready" && !!row1b.poster_asset_id);
  const posterRow = (await pool.query("SELECT * FROM assets WHERE id = $1", [row1b.poster_asset_id])).rows[0];
  check("poster asset is a 640x640 PNG", posterRow?.kind === "poster" && posterRow?.width === 640 && posterRow?.height === 640);
  const posterHttp = await api(`/api/assets/${row1b.poster_asset_id}`, { cookie: cookieA });
  check("poster bytes serve as PNG", posterHttp.status === 200 && posterHttp.buf.subarray(0, 4).toString("hex") === "89504e47");
  check("USDZ adapter produced a stored model-usdz asset", row1b.usdz_status === "ready" && row1b.usdz_bytes > 0 && !!row1b.usdz_asset_id);
} else {
  check("processor honestly labelled passthrough", row1b.processor === "passthrough");
  check("passthrough variants are byte-identical copies of the source", row1b.high_bytes === validBytes.length && row1b.low_bytes === validBytes.length);
  check("poster honestly not-configured", row1b.poster_status === "not-configured" && !row1b.poster_asset_id);
  check("USDZ honestly not-configured", row1b.usdz_status === "not-configured" && !row1b.usdz_asset_id);
}

// --- Published access for variants + guest payload ----------------------------------
const lowAnon = await api(`/api/assets/${row1b.low_asset_id}`);
check("low variant is public while the menu is published", lowAnon.status === 200 && lowAnon.buf.length === row1b.low_bytes);
const lowByBEarly = await api(`/api/assets/${row1b.low_asset_id}`, { cookie: cookieB });
check("published rule governs variants: another signed-in owner also receives it while published", lowByBEarly.status === 200);
const menu = await api(`/api/menu/${businessA}`);
const menuItem = menu.json?.products?.find((p) => p.id === item1.id);
check("guest payload carries the model3d bundle", !!menuItem?.model3d && menuItem.model3d.low === `/api/assets/${row1b.low_asset_id}` && menuItem.model3d.high === `/api/assets/${row1b.high_asset_id}`);
const viewsBefore = (await pool.query("SELECT views FROM products WHERE id = $1", [item1.id])).rows[0].views;
const open3d = await api(`/api/menu/${businessA}`, { method: "POST", body: { productId: item1.id, type: "3d_open", sessionId: `sess-${stamp}-xyz` } });
const events3d = (await pool.query("SELECT * FROM guest_events WHERE item_id = $1 AND type = '3d_open'", [item1.id])).rows;
const viewsAfter = (await pool.query("SELECT views FROM products WHERE id = $1", [item1.id])).rows[0].views;
check("3d_open is recorded as its own event type without inflating views", open3d.json?.ok === true && events3d.length === 1 && viewsAfter === viewsBefore);

const unpub = await api("/api/workspace", { method: "PATCH", cookie: cookieA, body: { name: wsA.json.business.name, published: false } });
check("owner can unpublish", unpub.json?.published === false);
const lowAnon2 = await api(`/api/assets/${row1b.low_asset_id}`);
check("low variant stops being public when unpublished", lowAnon2.status === 404);
// Note: re-publishing from here would require a verified email (Phase 1
// rule), which this suite leaves to verify-flow; nothing below needs the
// menu published again.

// --- Corrupt GLB fails the job, never the worker --------------------------------------
const corruptBytes = corruptJsonGlb();
const up2 = await upload(cookieA, corruptBytes, "corrupt.glb");
check("header-valid but JSON-corrupt GLB still uploads (deep gate is the pipeline's)", up2.status === 200);
const item2 = await makeItem(cookieA, "Corrupt Dish", up2.json.url);
const w2 = await worker(SECRET);
check("worker survives the corrupt GLB and reports the failure", w2.json?.processed === 1 && w2.json.outcomes[0].status === "failed");
const row2 = await modelRow(item2.id);
check("corrupt item is failed with the parser's reason", row2?.status === "failed" && /JSON chunk does not parse/.test(row2.error_message ?? ""));
const jobs2 = await jobRows(row2.id);
check("corrupt job is marked failed, not stuck processing", jobs2.length === 1 && jobs2[0].status === "failed");

// Retry the corrupt item: a fresh job queues and fails again with attempts counted.
const retry = await api("/api/models", { method: "POST", cookie: cookieA, body: { itemId: item2.id, action: "retry" } });
check("retry re-queues the failed item (202)", retry.status === 202);
const w3 = await worker(SECRET);
const jobs2b = await jobRows(row2.id);
check("retried job runs and fails again; history kept", w3.json?.processed === 1 && jobs2b.length === 2 && jobs2b.every((j) => j.status === "failed"));

// A valid item queued after the failures still processes (worker not poisoned).
const up3 = await upload(cookieA, triangleGlb());
const item3 = await makeItem(cookieA, "Plain Dish", up3.json.url);
const w4 = await worker(SECRET);
const row3 = await modelRow(item3.id);
check("worker still processes good jobs after failures", w4.json?.processed === 1 && row3?.status === "ready" && row3.triangle_count === 1);

// --- Over-limit model (placed in storage directly) --------------------------------------
const hugeBytes = hugeTriangleGlb();
const ownerAId = (await pool.query("SELECT owner_id FROM businesses WHERE id = $1", [businessA])).rows[0].owner_id;
const hugeAssetId = `huge${stamp}`.replace(/[^a-z0-9]/gi, "").slice(0, 24);
const hugeKey = `assets/${ownerAId}/${hugeAssetId}.glb`;
await fs.mkdir(path.join(process.cwd(), ".storage", "assets", ownerAId), { recursive: true });
await fs.writeFile(path.join(process.cwd(), ".storage", hugeKey), hugeBytes);
await pool.query("INSERT INTO assets (id, owner_id, business_id, kind, storage_key, mime, bytes, sha256, status) VALUES ($1,$2,$3,'model-source',$4,'model/gltf-binary',$5,$6,'ready')", [hugeAssetId, ownerAId, businessA, hugeKey, hugeBytes.length, sha256(hugeBytes)]);
const item4 = await makeItem(cookieA, "Huge Dish", `/api/assets/${hugeAssetId}`);
const w5 = await worker(SECRET);
const row4 = await modelRow(item4.id);
check("over-limit model fails with the triangle-limit reason", w5.json?.processed === 1 && row4?.status === "failed" && /triangles/.test(row4.error_message ?? ""));

// --- Upload gate rejects a truncated GLB --------------------------------------------------
const truncated = validBytes.subarray(0, validBytes.length - 12);
const upBad = await upload(cookieA, Buffer.from(truncated), "truncated.glb");
check("truncated GLB is rejected at upload", upBad.status === 400);

// --- Removing the model clears tracking; changing it re-queues ------------------------------
const patch = await api("/api/products", { method: "PATCH", cookie: cookieA, body: { id: item3.id, name: "Plain Dish", description: "d", price: 1200, category: "Main courses", image: "", model: "", tags: [], photos: [], available: true } });
check("product update without a model succeeds", !!patch.json?.id);
const row3b = await modelRow(item3.id);
check("removing the model clears the tracking row to none", row3b?.status === "none" && !row3b.source_asset_id);

// --- Tenant isolation ----------------------------------------------------------------------
const studioB = await api("/api/models", { cookie: cookieB });
check("owner B's studio has none of A's modelled items", studioB.json?.summary?.withModel === 0 && !studioB.json.items.some((i) => i.itemId === item1.id));
const foreign = await api("/api/models", { method: "POST", cookie: cookieB, body: { itemId: item1.id, action: "process" } });
check("owner B cannot queue A's item (400)", foreign.status === 400);

console.log(failures === 0 ? `\nALL CHECKS PASSED (${TOOLS ? "tools" : "default"} mode)` : `\n${failures} CHECK(S) FAILED (${TOOLS ? "tools" : "default"} mode)`);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
