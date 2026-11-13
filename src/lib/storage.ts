// Object storage for asset bytes (fixes G3: files no longer live in
// Postgres as base64). The database stores metadata + a storage key only.
//
// Two backends, chosen by environment — the same pattern as the Phase 1
// rate limiter (Upstash REST when configured, in-memory otherwise):
//
// - **Cloudflare R2** (S3-compatible) when R2_ACCOUNT_ID,
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are all set.
//   Requests are signed by hand with AWS Signature Version 4 (node crypto
//   only — no SDK dependency), against the account's S3 endpoint.
// - **Local disk** otherwise: files under ASSET_STORAGE_DIR (default
//   `<cwd>/.storage`). This is the dev/test backend and needs no account,
//   so everything in Phase 2 is fully exercisable before Hamza creates
//   the Cloudflare account (an owner-only step in docs/DECISIONS.md).
//
// Keys are app-generated (`assets/<ownerId>/<id>.<ext>` or
// `quarantine/<ownerId>/<id>.<ext>`) and are validated to stay inside the
// storage root — a key can never escape via `..` or an absolute path.

import { createHash, createHmac } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type StorageConfig =
  | { type: "r2"; accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }
  | { type: "local"; dir: string };

export function storageConfig(): StorageConfig {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
    return {
      type: "r2",
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_BUCKET,
    };
  }
  return { type: "local", dir: process.env.ASSET_STORAGE_DIR || path.join(process.cwd(), ".storage") };
}

export function assertSafeStorageKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((s) => s === ".." || s === "")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

// ---------------------------------------------------------------------------
// AWS Signature Version 4 (hand-rolled; used for R2's S3 endpoint)

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function sigV4Authorization(opts: {
  method: string;
  host: string;
  canonicalUri: string;
  payload: Buffer;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  service?: string;
  now?: Date;
}): { authorization: string; amzDate: string; payloadHash: string } {
  const region = opts.region ?? "auto"; // R2 uses the "auto" region.
  const service = opts.service ?? "s3";
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(opts.payload).digest("hex");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${opts.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [opts.method, opts.canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest, "utf8").digest("hex")].join("\n");
  const kDate = hmac(`AWS4${opts.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHash,
  };
}

function encodeKeyForUri(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function r2Request(
  cfg: Extract<StorageConfig, { type: "r2" }>,
  method: "PUT" | "GET" | "DELETE",
  key: string,
  payload?: Buffer,
): Promise<{ status: number; body: Buffer }> {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${cfg.bucket}/${encodeKeyForUri(key)}`;
  const body = payload ?? Buffer.alloc(0);
  const { authorization, amzDate, payloadHash } = sigV4Authorization({
    method,
    host,
    canonicalUri,
    payload: body,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  });
  const res = await fetch(`https://${host}${canonicalUri}`, {
    method,
    headers: {
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
    body: method === "PUT" ? new Uint8Array(body) : undefined,
  });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

// ---------------------------------------------------------------------------
// Backend operations

function localPath(cfg: Extract<StorageConfig, { type: "local" }>, key: string): string {
  assertSafeStorageKey(key);
  return path.join(cfg.dir, ...key.split("/"));
}

export async function storagePut(key: string, data: Buffer): Promise<void> {
  assertSafeStorageKey(key);
  const cfg = storageConfig();
  if (cfg.type === "local") {
    const file = localPath(cfg, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    return;
  }
  const { status } = await r2Request(cfg, "PUT", key, data);
  if (status < 200 || status >= 300) throw new Error(`R2 PUT failed with status ${status}`);
}

export async function storageGet(key: string): Promise<Buffer | null> {
  assertSafeStorageKey(key);
  const cfg = storageConfig();
  if (cfg.type === "local") {
    try {
      return await fs.readFile(localPath(cfg, key));
    } catch {
      return null;
    }
  }
  const { status, body } = await r2Request(cfg, "GET", key);
  if (status === 404) return null;
  if (status < 200 || status >= 300) throw new Error(`R2 GET failed with status ${status}`);
  return body;
}

export async function storageDelete(key: string): Promise<void> {
  assertSafeStorageKey(key);
  const cfg = storageConfig();
  if (cfg.type === "local") {
    await fs.rm(localPath(cfg, key), { force: true });
    return;
  }
  const { status } = await r2Request(cfg, "DELETE", key);
  if (status < 200 || status >= 300) throw new Error(`R2 DELETE failed with status ${status}`);
}

/** Promote a quarantined object to its final key (copy + delete source). */
export async function storageMove(fromKey: string, toKey: string): Promise<void> {
  const data = await storageGet(fromKey);
  if (!data) throw new Error(`Cannot move missing storage object: ${fromKey}`);
  await storagePut(toKey, data);
  await storageDelete(fromKey);
}
