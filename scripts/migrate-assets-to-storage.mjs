#!/usr/bin/env node
// Phase 2 legacy-asset migration tool.
//
// Moves every legacy base64 asset (assets.data, written by the pre-Phase-2
// upload route) into the storage backend (R2 when R2_* env is set, local
// disk otherwise — same rules as src/lib/storage.ts) and fills the new
// metadata columns. Every asset is verified BYTE-IDENTICAL: the sha256 of
// the decoded original is compared with the sha256 of the object read back
// from storage, and both hashes land in a JSON report.
//
//   DATABASE_URL=... node scripts/migrate-assets-to-storage.mjs [--report path]
//
// Safe to re-run: rows that already have a storage_key are skipped. Rows
// are only updated after their read-back hash matches, so a failure leaves
// the legacy row untouched. After a clean run, `npm run db:migrate`
// applies drizzle/0002, whose guard drops the data column only when no
// unmigrated rows remain.

import { createHash, createHmac } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import pg from "pg";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// --- Storage backend (mirrors src/lib/storage.ts) ---------------------------

function storageConfig() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
    return { type: "r2", accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET };
  }
  return { type: "local", dir: process.env.ASSET_STORAGE_DIR || path.join(process.cwd(), ".storage") };
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

async function r2(cfg, method, key, payload) {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const canonicalUri = `/${cfg.bucket}/${encodedKey}`;
  const body = payload ?? Buffer.alloc(0);
  const payloadHash = sha256(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(Buffer.from(canonicalRequest, "utf8"))].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, dateStamp), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const res = await fetch(`https://${host}${canonicalUri}`, {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
    body: method === "PUT" ? body : undefined,
  });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

async function storagePut(cfg, key, data) {
  if (cfg.type === "local") {
    const file = path.join(cfg.dir, ...key.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    return;
  }
  const { status } = await r2(cfg, "PUT", key, data);
  if (status < 200 || status >= 300) throw new Error(`R2 PUT ${key} -> ${status}`);
}

async function storageGet(cfg, key) {
  if (cfg.type === "local") {
    try {
      return await fs.readFile(path.join(cfg.dir, ...key.split("/")));
    } catch {
      return null;
    }
  }
  const { status, body } = await r2(cfg, "GET", key);
  if (status === 404) return null;
  if (status < 200 || status >= 300) throw new Error(`R2 GET ${key} -> ${status}`);
  return body;
}

// --- Image dimensions (subset of src/lib/media-validation.ts) ---------------

function imageDimensions(buf, mime) {
  try {
    if (mime === "image/png") {
      if (buf.length < 24 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let pos = 2;
      while (pos + 4 <= buf.length) {
        if (buf[pos] !== 0xff) return null;
        const marker = buf[pos + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
        const len = buf.readUInt16BE(pos + 2);
        if (len < 2) return null;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(pos + 7), height: buf.readUInt16BE(pos + 5) };
        }
        pos += 2 + len;
      }
      return null;
    }
    if (mime === "image/webp") {
      const chunk = buf.toString("latin1", 12, 16);
      if (chunk === "VP8X" && buf.length >= 30) return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "model/gltf-binary": "glb" };

// --- Main --------------------------------------------------------------------

const reportPath = (() => {
  const i = process.argv.indexOf("--report");
  return i >= 0 ? process.argv[i + 1] : "asset-migration-report.json";
})();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const cfg = storageConfig();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const report = { generatedAt: new Date().toISOString(), backend: cfg.type, total: 0, migrated: 0, failed: 0, assets: [] };

try {
  const cols = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'assets'",
  );
  const colNames = new Set(cols.rows.map((r) => r.column_name));
  const hasData = colNames.has("data");
  if (!hasData) {
    report.note = "assets.data column is already gone — nothing to migrate.";
  } else {
    if (!colNames.has("storage_key")) {
      // Legacy DB that has only the Phase 1 baseline: drizzle-kit migrate
      // cannot be used to reach this state (it applies 0001+0002 in one
      // transaction and 0002's guard aborts while data is unmoved), so
      // apply the idempotent 0001 file directly, exactly as generated.
      const sqlPath = new URL("../drizzle/0001_asset-storage-columns.sql", import.meta.url);
      const sql = await fs.readFile(sqlPath, "utf8");
      for (const stmt of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
        await client.query(stmt);
      }
      report.appliedPreMigration = "drizzle/0001_asset-storage-columns.sql";
      console.log("Applied drizzle/0001_asset-storage-columns.sql (storage columns were missing).");
    }
    const { rows } = await client.query(
      "SELECT id, owner_id, mime, data FROM assets WHERE storage_key IS NULL ORDER BY id",
    );
    report.total = rows.length;
    for (const row of rows) {
      const original = Buffer.from(row.data, "base64");
      const sha256Before = sha256(original);
      const entry = { id: row.id, mime: row.mime, bytes: original.length, sha256Before, sha256After: null, storageKey: null, ok: false };
      try {
        const kind = row.mime === "model/gltf-binary" ? "model-source" : "photo";
        const ext = EXT_BY_MIME[row.mime] || "bin";
        const key = `assets/${row.owner_id}/${row.id}.${ext}`;
        await storagePut(cfg, key, original);
        const back = await storageGet(cfg, key);
        const sha256After = back ? sha256(back) : null;
        entry.sha256After = sha256After;
        entry.storageKey = key;
        if (!back || sha256After !== sha256Before || back.length !== original.length) {
          throw new Error("read-back hash mismatch — row left unmigrated");
        }
        const dims = imageDimensions(original, row.mime);
        await client.query(
          "UPDATE assets SET storage_key = $1, kind = $2, bytes = $3, sha256 = $4, width = $5, height = $6, status = 'ready' WHERE id = $7",
          [key, kind, original.length, sha256Before, dims?.width ?? null, dims?.height ?? null, row.id],
        );
        entry.ok = true;
        report.migrated++;
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        report.failed++;
      }
      report.assets.push(entry);
      console.log(`${entry.ok ? "OK  " : "FAIL"} ${row.id} ${row.mime} ${original.length}B sha256=${sha256Before.slice(0, 12)}…`);
    }
  }
} finally {
  await client.end();
}

await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Report: ${reportPath} — total ${report.total}, migrated ${report.migrated}, failed ${report.failed}, backend ${report.backend}`);
process.exit(report.failed > 0 ? 1 : 0);
