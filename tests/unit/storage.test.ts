import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { storageConfig, storagePut, storageGet, storageDelete, storageMove, assertSafeStorageKey, sigV4Authorization } from "@/lib/storage";
import { signAsset, signedAssetPath, verifyAssetSignature } from "@/lib/asset-signing";
import { scanForMalware } from "@/lib/av-scan";

let dir: string;
const OLD_ENV = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "platera-storage-"));
  process.env.ASSET_STORAGE_DIR = dir;
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
});

describe("storageConfig", () => {
  it("falls back to local disk when R2 env is incomplete", () => {
    expect(storageConfig()).toEqual({ type: "local", dir });
    process.env.R2_ACCOUNT_ID = "acc";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    // bucket still missing -> still local
    expect(storageConfig().type).toBe("local");
    process.env.R2_BUCKET = "platera-assets";
    expect(storageConfig()).toEqual({ type: "r2", accountId: "acc", accessKeyId: "key", secretAccessKey: "secret", bucket: "platera-assets" });
  });
});

describe("local storage backend", () => {
  it("round-trips bytes, moves (quarantine promote) and deletes", async () => {
    const data = Buffer.from("fake-glb-bytes");
    await storagePut("quarantine/owner1/abc.glb", data);
    expect(await storageGet("quarantine/owner1/abc.glb")).toEqual(data);
    await storageMove("quarantine/owner1/abc.glb", "assets/owner1/abc.glb");
    expect(await storageGet("quarantine/owner1/abc.glb")).toBeNull();
    expect(await storageGet("assets/owner1/abc.glb")).toEqual(data);
    await storageDelete("assets/owner1/abc.glb");
    expect(await storageGet("assets/owner1/abc.glb")).toBeNull();
  });
  it("returns null for a missing object", async () => {
    expect(await storageGet("assets/nobody/nothing.png")).toBeNull();
  });
  it("rejects path-escaping keys", () => {
    expect(() => assertSafeStorageKey("../escape")).toThrow();
    expect(() => assertSafeStorageKey("/absolute/path")).toThrow();
    expect(() => assertSafeStorageKey("assets//double")).toThrow();
    expect(() => assertSafeStorageKey("assets/ok/key.png")).not.toThrow();
  });
});

describe("SigV4 signing (R2)", () => {
  it("produces a well-formed Authorization header with the payload hash", () => {
    const { authorization, amzDate, payloadHash } = sigV4Authorization({
      method: "PUT",
      host: "acc123.r2.cloudflarestorage.com",
      canonicalUri: "/platera-assets/assets/owner1/abc.glb",
      payload: Buffer.from("abc"),
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      now: new Date("2015-08-30T12:36:00Z"),
    });
    expect(amzDate).toBe("20150830T123600Z");
    // sha256("abc") — the payload hash must be the real one.
    expect(payloadHash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });
  it("changes the signature when the payload changes", () => {
    const base = {
      method: "PUT",
      host: "acc123.r2.cloudflarestorage.com",
      canonicalUri: "/b/k.glb",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret",
      now: new Date("2026-01-01T00:00:00Z"),
    };
    const a = sigV4Authorization({ ...base, payload: Buffer.from("one") });
    const b = sigV4Authorization({ ...base, payload: Buffer.from("two") });
    expect(a.authorization).not.toBe(b.authorization);
  });
});

describe("asset signing", () => {
  it("signs and verifies; tampered id/exp/sig all fail", () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = signAsset("asset123", exp);
    expect(verifyAssetSignature("asset123", String(exp), sig)).toBe(true);
    expect(verifyAssetSignature("other999", String(exp), sig)).toBe(false);
    expect(verifyAssetSignature("asset123", String(exp + 60), sig)).toBe(false);
    expect(verifyAssetSignature("asset123", String(exp), sig.slice(0, -2) + "00")).toBe(false);
  });
  it("rejects expired and malformed signatures", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(verifyAssetSignature("a", String(past), signAsset("a", past))).toBe(false);
    expect(verifyAssetSignature("a", "notanumber", "x")).toBe(false);
    expect(verifyAssetSignature("a", null, null)).toBe(false);
  });
  it("signedAssetPath embeds id, exp and sig", () => {
    const p = signedAssetPath("asset123", 60);
    expect(p).toMatch(/^\/api\/assets\/asset123\?exp=\d+&sig=[0-9a-f]{64}$/);
  });
});

describe("AV scan hook", () => {
  it("reports skipped when AV_SCAN_URL is unset (honest no-scan state)", async () => {
    delete process.env.AV_SCAN_URL;
    expect(await scanForMalware(Buffer.from("x"), "x.png")).toEqual({ status: "skipped" });
  });
  it("maps 200 -> clean, 422 -> infected, 500/network -> unavailable (fail closed)", async () => {
    process.env.AV_SCAN_URL = "http://scanner.test/scan";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    expect((await scanForMalware(Buffer.from("x"), "x.png")).status).toBe("clean");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("virus", { status: 422 })));
    expect((await scanForMalware(Buffer.from("x"), "x.png")).status).toBe("infected");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect((await scanForMalware(Buffer.from("x"), "x.png")).status).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("conn refused"); }));
    expect((await scanForMalware(Buffer.from("x"), "x.png")).status).toBe("unavailable");
  });
});
