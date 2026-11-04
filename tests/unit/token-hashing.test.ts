import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { hashToken } from "@/lib/auth";

describe("hashToken (session / verification token storage)", () => {
  it("is the SHA-256 hex of the raw token, never the token itself", () => {
    const raw = "a".repeat(64);
    const hashed = hashToken(raw);
    expect(hashed).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(hashed).not.toBe(raw);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic, so lookups by hash are stable", () => {
    expect(hashToken("some-token")).toBe(hashToken("some-token"));
  });

  it("gives different hashes for different tokens", () => {
    expect(hashToken("token-one")).not.toBe(hashToken("token-two"));
  });
});
