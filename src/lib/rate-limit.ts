// Lightweight in-memory rate limiter for auth endpoints.
// NOTE: this state lives in a single server process. It resets on deploy/restart
// and is not shared across multiple instances. For a multi-instance production
// deployment, replace this with a shared store (e.g. Upstash Redis, Vercel KV).

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

function cleanup(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) if (bucket.reset < now) buckets.delete(key);
}

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
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

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
