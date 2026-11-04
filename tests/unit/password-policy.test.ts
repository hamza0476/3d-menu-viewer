import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "crypto";
import { passwordProblem, isBreached } from "@/lib/password-policy";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").toUpperCase();

// Mocks the HIBP range endpoint: answers with the suffix list for the
// requested prefix, marking `breachedFor` passwords as breached.
function mockHibp(breachedFor: string | null) {
  return vi.fn(async (url: string) => {
    const prefix = String(url).split("/range/")[1];
    const lines: string[] = ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3", "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:1"];
    if (breachedFor) {
      const hash = sha1(breachedFor);
      if (hash.startsWith(prefix)) lines.push(`${hash.slice(5)}:987654`);
    }
    return { ok: true, text: async () => lines.join("\n") };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("passwordProblem", () => {
  it("rejects passwords under 10 characters (and over 128) without calling HIBP", async () => {
    const fetchSpy = mockHibp(null);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await passwordProblem("short-9ch")).toMatch(/10–128/);
    expect(await passwordProblem("x".repeat(129))).toMatch(/10–128/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a password that appears in the breach corpus", async () => {
    vi.stubGlobal("fetch", mockHibp("password12345"));
    expect(await passwordProblem("password12345")).toMatch(/data breach/);
  });

  it("accepts a long password that is not in the corpus", async () => {
    vi.stubGlobal("fetch", mockHibp("someone-elses-password"));
    expect(await passwordProblem("my-own-strong-passphrase")).toBeNull();
  });

  it("fails OPEN when the breach service is unreachable (sign-ups must not break)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await passwordProblem("perfectly-fine-length")).toBeNull();
  });
});

describe("isBreached k-anonymity", () => {
  it("only ever sends the 5-character SHA-1 prefix to HIBP", async () => {
    const fetchSpy = mockHibp(null);
    vi.stubGlobal("fetch", fetchSpy);
    await isBreached("some-secret-value");
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    const fullHash = sha1("some-secret-value");
    expect(calledUrl.endsWith(`/range/${fullHash.slice(0, 5)}`)).toBe(true);
    expect(calledUrl).not.toContain(fullHash.slice(5));
  });
});
