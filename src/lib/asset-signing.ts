// Signed URLs for private assets (part of the S6 fix).
//
// Published-menu assets are served publicly by /api/assets/[id]. Everything
// else — sources and assets of unpublished restaurants — is private: the
// owner reaches it with their session cookie, or with a short-lived signed
// URL minted at /api/assets/[id]/preview (owner-only). A signature is an
// HMAC-SHA256 over `<assetId>.<expiry>`; tampering with either invalidates
// it, and verification is constant-time.
//
// Secret: ASSET_SIGNING_SECRET in production. For local development only,
// when it is unset the secret is derived from DATABASE_URL so signed URLs
// still work in dev/test without extra setup — production must set the
// dedicated secret (see .env.example).

import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SIGNED_URL_TTL_SECONDS = 300;

function signingSecret(): string {
  if (process.env.ASSET_SIGNING_SECRET) return process.env.ASSET_SIGNING_SECRET;
  return createHash("sha256").update(`${process.env.DATABASE_URL ?? ""}:platera-asset-signing`).digest("hex");
}

export function signAsset(assetId: string, expiresAtUnix: number): string {
  return createHmac("sha256", signingSecret()).update(`${assetId}.${expiresAtUnix}`).digest("hex");
}

export function signedAssetPath(assetId: string, ttlSeconds: number = SIGNED_URL_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/assets/${assetId}?exp=${exp}&sig=${signAsset(assetId, exp)}`;
}

export function verifyAssetSignature(assetId: string, expRaw: string | null, sigRaw: string | null): boolean {
  if (!expRaw || !sigRaw) return false;
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signAsset(assetId, exp), "utf8");
  const given = Buffer.from(sigRaw, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
