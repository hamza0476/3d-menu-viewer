// Rate limiting for auth endpoints — Redis-backed when configured, with an
// in-memory fallback.
//
// Production (multi-instance/serverless): set UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN and all instances share one limiter via the
// Upstash REST API (no extra dependency; plain fetch).
// Local dev / single instance: leave them unset and the limiter runs in
// memory — it resets on restart and is per-process, exactly like before.
//
// If Redis is configured but unreachable, the limiter logs once and falls
// back to memory for that call rather than locking every user out.

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

function cleanup(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) if (bucket.reset < now) buckets.delete(key);
}

function memoryLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  cleanup(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit) return { allowed: false, retryAfterSeconds: Math.ceil((bucket.reset - now) / 1000) };
  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redisLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const cfg = redisConfig();
  if (!cfg) return memoryLimit(key, limit, windowMs);
  const redisKey = `rl:${key}`;
  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", redisKey], ["PTTL", redisKey]]),
    });
    if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
    const data = (await res.json()) as { result: number }[];
    const count = data[0]?.result;
    let ttlMs = data[1]?.result;
    if (typeof count !== "number") throw new Error("Unexpected Upstash response");
    if (count === 1 || ttlMs === -1) {
      // First hit in the window (or a key with no expiry): set the window.
      await fetch(`${cfg.url}/pexpire/${encodeURIComponent(redisKey)}/${windowMs}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      }).catch(() => {});
      ttlMs = windowMs;
    }
    if (count > limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((ttlMs || windowMs) / 1000)) };
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (e) {
    console.error("[rate-limit] Redis unavailable, falling back to in-memory limiter:", e instanceof Error ? e.message : e);
    return memoryLimit(key, limit, windowMs);
  }
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  return redisLimit(key, limit, windowMs);
}

// Client IP for rate-limit keys. Forwarding headers are only trustworthy
// when a platform sets them and strips client-supplied values:
// - Cloudflare sets cf-connecting-ip (and overwrites client-supplied ones).
// - Vercel sets x-vercel-forwarded-for the same way.
// Generic x-forwarded-for / x-real-ip are honoured ONLY when the operator
// opts in with TRUST_PROXY_HEADERS=1 (i.e. "I run behind a proxy I control
// that sets these"). Trusting them unconditionally — the old behaviour — let
// any caller mint a fresh IP per request by spoofing the header.
export function clientIp(req: { headers: Headers }): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  if (process.env.TRUST_PROXY_HEADERS === "1") {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return "unknown";
}
