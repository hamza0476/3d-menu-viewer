// HTTP-level integration tests for Phase 2 media & storage:
// upload validation (magic bytes), quarantine/storage on disk, metadata
// rows, and the S6 access rules (published = public, else owner/signed).
// Run via: ASSET_STORAGE_DIR=<tmp> bash tests/integration/run.sh assets-media.mjs
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import pg from "pg";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const DB = process.env.PGDATABASE_URL;
const STORAGE_DIR = process.env.ASSET_STORAGE_DIR;
if (!DB || !STORAGE_DIR) { console.error("PGDATABASE_URL and ASSET_STORAGE_DIR are required"); process.exit(2); }

let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS " : "FAIL ") + name);
  if (!cond) failures++;
}
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function cookieOf(res) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of cookies) { const m = c.match(/platera_session=([^;]+)/); if (m) return m[1]; }
  return null;
}
async function api(pathname, { method = "GET", body, cookie, raw } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { ...(body && !raw ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: `platera_session=${cookie}` } : {}) },
    body: raw ? raw : body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (raw || method === "GET") {
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString()); } catch {}
    return { res, status: res.status, json, buf, cookie: cookieOf(res) };
  }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { res, status: res.status, json, cookie: cookieOf(res) };
}
async function upload(cookie, buf, { name = "dish.png", type = "image/png", kind } = {}) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type }), name);
  if (kind) form.append("kind", kind);
  return api("/api/assets", { method: "POST", cookie, raw: form });
}

// --- Fixtures -----------------------------------------------------------------
function pngFixture(width = 3, height = 5) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const chunk = Buffer.alloc(25);
  chunk.writeUInt32BE(13, 0); chunk.write("IHDR", 4, "latin1"); ihdr.copy(chunk, 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk]);
}
function glbFixture() {
  const json = Buffer.from('{"asset":{"version":"2.0"}}');
  const pad = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(pad);
  const buf = Buffer.alloc(12 + 8 + pad.length);
  buf.write("glTF", 0, "latin1"); buf.writeUInt32LE(2, 4); buf.writeUInt32LE(buf.length, 8);
  buf.writeUInt32LE(pad.length, 12); buf.write("JSON", 16, "latin1"); pad.copy(buf, 20);
  return buf;
}
const png = pngFixture();
const glb = glbFixture();

const pool = new pg.Pool({ connectionString: DB });
const stamp = Date.now();
const regA = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner A", email: `a-${stamp}@example.com`, password: `A-owner-${stamp}-pass!`, businessName: "A's Place" } });
const cookieA = regA.cookie;
check("owner A registers", regA.json?.ok === true && !!cookieA);
const regB = await api("/api/auth", { method: "POST", body: { action: "register", name: "Owner B", email: `b-${stamp}@example.com`, password: `B-owner-${stamp}-pass!`, businessName: "B's Place" } });
const cookieB = regB.cookie;
check("owner B registers", regB.json?.ok === true && !!cookieB);

// --- Upload gate ---------------------------------------------------------------
const noAuth = await upload(null, png);
check("unauthenticated upload -> 401", noAuth.status === 401);

const upPng = await upload(cookieA, png);
check("real PNG upload succeeds, url shape unchanged", upPng.status === 200 && /^\/api\/assets\/[0-9a-f]+$/.test(upPng.json?.url || ""));
check("upload reports kind photo + sha256 of the bytes", upPng.json?.kind === "photo" && upPng.json?.sha256 === sha256(png));
const pngUrl = upPng.json?.url;
const pngId = pngUrl?.split("/").pop();

const rowRes = await pool.query("SELECT storage_key, bytes, width, height, sha256, kind FROM assets WHERE id = $1", [pngId]);
const row = rowRes.rows[0];
check("DB row stores metadata only (storage_key/bytes/dims/sha)", !!row && row.bytes === png.length && row.width === 3 && row.height === 5 && row.sha256 === sha256(png) && row.kind === "photo");
const onDisk = row ? readFileSync(path.join(STORAGE_DIR, row.storage_key)) : null;
check("bytes live in storage, identical to the upload", !!onDisk && onDisk.equals(png));

const html = await upload(cookieA, Buffer.from("<!doctype html><script>alert(1)</script>"), { name: "evil.png", type: "image/png" });
check("HTML disguised as PNG (client MIME lies) -> 400", html.status === 400);
const fakeGlb = await upload(cookieA, Buffer.from("not a model at all"), { name: "model.glb", type: "model/gltf-binary" });
check("text file named .glb -> 400", fakeGlb.status === 400);
const trunc = await upload(cookieA, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { name: "t.png" });
check("truncated PNG (signature only) -> 400", trunc.status === 400);

const upGlb = await upload(cookieA, glb, { name: "dish.glb", type: "model/gltf-binary" });
check("valid GLB upload succeeds as model-source", upGlb.status === 200 && upGlb.json?.kind === "model-source");
const glbUrl = upGlb.json?.url;

const quarantineDir = path.join(STORAGE_DIR, "quarantine");
const leftovers = existsSync(quarantineDir) ? readdirSync(quarantineDir, { recursive: true }).filter((f) => String(f).includes(".")) : [];
check("quarantine is empty after successful uploads (promoted, not copied)", leftovers.length === 0);

// --- Access control: unreferenced asset is private ------------------------------
const anonPrivate = await api(pngUrl);
check("unreferenced asset: anonymous -> 404 (S6 hole closed)", anonPrivate.status === 404);
const ownerPrivate = await api(pngUrl, { cookie: cookieA });
check("unreferenced asset: owner -> 200, bytes identical", ownerPrivate.status === 200 && ownerPrivate.buf.equals(png));
check("private response cache header is no-store, never immutable", (ownerPrivate.res.headers.get("cache-control") || "").includes("no-store"));
const otherOwner = await api(pngUrl, { cookie: cookieB });
check("unreferenced asset: a different owner -> 404", otherOwner.status === 404);

// --- Published menu makes it public ---------------------------------------------
const dish = await api("/api/products", { method: "POST", cookie: cookieA, body: { name: "Photo Dish", price: 1200, category: "Mains", image: pngUrl, photos: [pngUrl], model: glbUrl } });
check("product created referencing the assets", dish.status === 200);
const anonPublic = await api(pngUrl);
check("published menu asset: anonymous -> 200 with identical bytes", anonPublic.status === 200 && anonPublic.buf.equals(png));
check("public response keeps long immutable cache + sniffed mime", (anonPublic.res.headers.get("cache-control") || "").includes("immutable") && anonPublic.res.headers.get("content-type") === "image/png");
const anonGlb = await api(glbUrl);
check("published menu GLB: anonymous -> 200 (guest 3D still works)", anonGlb.status === 200 && anonGlb.buf.equals(glb));

// --- Unpublish: back to private, signed preview works ----------------------------
const unpub = await api("/api/workspace", { method: "PATCH", cookie: cookieA, body: { name: "A's Place", published: false } });
check("owner unpublishes the restaurant", unpub.status === 200 && unpub.json?.published === false);
const anonAfter = await api(pngUrl);
check("after unpublish: anonymous -> 404 again", anonAfter.status === 404);
const ownerAfter = await api(pngUrl, { cookie: cookieA });
check("after unpublish: owner still -> 200", ownerAfter.status === 200);

const preview = await api(`/api/assets/${pngId}/preview`, { cookie: cookieA });
check("owner preview -> temporary redirect to a signed URL", [302, 307, 308].includes(preview.status) && /sig=[0-9a-f]{64}/.test(preview.res.headers.get("location") || ""));
const signedPath = new URL(preview.res.headers.get("location"), BASE).pathname + new URL(preview.res.headers.get("location"), BASE).search;
const viaSigned = await api(signedPath);
check("signed URL serves the private asset anonymously", viaSigned.status === 200 && viaSigned.buf.equals(png));
check("signed response is private/no-store (no immutable leak)", (viaSigned.res.headers.get("cache-control") || "").includes("no-store"));
const tampered = await api(signedPath.replace(/sig=[0-9a-f]{2}/, "sig=ff"));
check("tampered signature -> 404", tampered.status === 404);
const previewB = await api(`/api/assets/${pngId}/preview`, { cookie: cookieB });
check("non-owner preview -> 404 (existence not leaked)", previewB.status === 404);
const ghost = await api("/api/assets/000000000000000000000000");
check("unknown asset id -> 404", ghost.status === 404);

await pool.end();
console.log(failures === 0 ? "ALL INTEGRATION CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
