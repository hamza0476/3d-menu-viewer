import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, uid } from "@/lib/auth";

describe("password hashing (scrypt)", () => {
  it("stores salt:hash and verifies the correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("right-password");
    expect(verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("uses a random salt, so the same password hashes differently twice", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });

  it("rejects malformed stored values instead of throwing", () => {
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", "no-colon-here")).toBe(false);
    expect(verifyPassword("anything", ":")).toBe(false);
  });
});

describe("uid", () => {
  it("returns 24 hex characters and does not repeat", () => {
    const a = uid();
    const b = uid();
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});
