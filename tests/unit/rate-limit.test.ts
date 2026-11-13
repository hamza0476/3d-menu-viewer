import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// The in-memory limiter is module-level state, so every test uses its own
// key to stay independent.
describe("rateLimit (in-memory fallback)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("allows requests up to the limit, then blocks with a retry delay", async () => {
    const key = "test-login-allow-block";
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit(key, 3, 60_000)).allowed).toBe(true);
    }
    const blocked = await rateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps separate keys independent", async () => {
    expect((await rateLimit("test-key-a", 1, 60_000)).allowed).toBe(true);
    expect((await rateLimit("test-key-a", 1, 60_000)).allowed).toBe(false);
    expect((await rateLimit("test-key-b", 1, 60_000)).allowed).toBe(true);
  });

  it("resets after the window passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const key = "test-window-reset";
    expect((await rateLimit(key, 1, 10_000)).allowed).toBe(true);
    expect((await rateLimit(key, 1, 10_000)).allowed).toBe(false);
    vi.setSystemTime(1_000_000 + 10_001);
    expect((await rateLimit(key, 1, 10_000)).allowed).toBe(true);
  });
});

describe("rateLimit (Upstash Redis configured)", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function mockUpstash(counts: number[], ttl = 30_000) {
    let i = 0;
    return vi.fn(async (url: string) => {
      if (String(url).includes("/pipeline")) {
        const count = counts[Math.min(i++, counts.length - 1)];
        return { ok: true, json: async () => [{ result: count }, { result: count === 1 ? -1 : ttl }] };
      }
      return { ok: true, json: async () => ({ result: "OK" }) }; // pexpire call
    });
  }

  it("allows up to the limit and blocks beyond it, using Redis counts", async () => {
    vi.stubGlobal("fetch", mockUpstash([1, 2, 3]));
    const key = "test-redis-limit";
    expect((await rateLimit(key, 2, 60_000)).allowed).toBe(true);
    expect((await rateLimit(key, 2, 60_000)).allowed).toBe(true);
    const blocked = await rateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(30);
  });

  it("falls back to the in-memory limiter when Redis errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const key = "test-redis-fallback";
    expect((await rateLimit(key, 1, 60_000)).allowed).toBe(true);
    expect((await rateLimit(key, 1, 60_000)).allowed).toBe(false);
  });
});

describe("clientIp", () => {
  function reqWith(headers: Record<string, string>) {
    return new Request("http://localhost/api/auth", { headers });
  }
  afterEach(() => vi.unstubAllEnvs());

  it("prefers cf-connecting-ip (set by Cloudflare, not spoofable by clients)", () => {
    expect(clientIp(reqWith({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("uses x-vercel-forwarded-for on Vercel", () => {
    expect(clientIp(reqWith({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("IGNORES spoofable x-forwarded-for / x-real-ip by default (the S4 fix)", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "203.0.113.7" }))).toBe("unknown");
    expect(clientIp(reqWith({ "x-real-ip": "198.51.100.3" }))).toBe("unknown");
    expect(clientIp(reqWith({}))).toBe("unknown");
  });

  it("honours x-forwarded-for only when TRUST_PROXY_HEADERS=1", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "1");
    expect(clientIp(reqWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(reqWith({ "x-real-ip": "198.51.100.3" }))).toBe("198.51.100.3");
  });
});
