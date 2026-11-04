import { describe, it, expect, vi, afterEach } from "vitest";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// The limiter is module-level in-memory state, so every test uses its own
// key to stay independent.
describe("rateLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit, then blocks with a retry delay", () => {
    const key = "test-login-allow-block";
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps separate keys independent", () => {
    expect(rateLimit("test-key-a", 1, 60_000).allowed).toBe(true);
    expect(rateLimit("test-key-a", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("test-key-b", 1, 60_000).allowed).toBe(true);
  });

  it("resets after the window passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const key = "test-window-reset";
    expect(rateLimit(key, 1, 10_000).allowed).toBe(true);
    expect(rateLimit(key, 1, 10_000).allowed).toBe(false);
    vi.setSystemTime(1_000_000 + 10_001);
    expect(rateLimit(key, 1, 10_000).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  function reqWith(headers: Record<string, string>) {
    return new Request("http://localhost/api/auth", { headers });
  }

  it("uses the first x-forwarded-for entry", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(clientIp(reqWith({ "x-real-ip": "198.51.100.3" }))).toBe("198.51.100.3");
    expect(clientIp(reqWith({}))).toBe("unknown");
  });
});
