import { describe, it, expect } from "vitest";
import { isSameOrigin } from "@/lib/csrf";

describe("isSameOrigin (CSRF origin check)", () => {
  it("allows a request with no Origin header (non-browser client)", () => {
    expect(isSameOrigin(null, "platera.example")).toBe(true);
  });

  it("allows a matching origin", () => {
    expect(isSameOrigin("https://platera.example", "platera.example")).toBe(true);
    expect(isSameOrigin("http://127.0.0.1:3100", "127.0.0.1:3100")).toBe(true);
  });

  it("blocks a cross-site origin", () => {
    expect(isSameOrigin("https://evil.example", "platera.example")).toBe(false);
    expect(isSameOrigin("https://platera.example.evil.com", "platera.example")).toBe(false);
  });

  it("blocks an unparseable origin", () => {
    expect(isSameOrigin("not a url", "platera.example")).toBe(false);
  });

  it("blocks when the host is unknown but an origin is present", () => {
    expect(isSameOrigin("https://platera.example", null)).toBe(false);
  });
});
