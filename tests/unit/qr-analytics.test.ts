import { describe, it, expect } from "vitest";
import { generateQrCode, isQrCodeShape, qrResolvePath, qrMenuPath, deviceClass, hashSessionAnonId, shouldCountEvent, EVENT_DEDUPE_WINDOW_MS } from "@/lib/qr";
import { dayKey, dayRange, aggregateEvents, buildAnalyticsSummary, toCsv, type RawEvent } from "@/lib/analytics";

describe("generateQrCode", () => {
  it("produces 12-char codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateQrCode();
      expect(code).toHaveLength(12);
      expect(isQrCodeShape(code)).toBe(true);
      expect(code).not.toMatch(/[0oO1lI]/);
    }
  });
  it("does not repeat in practice", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateQrCode()));
    expect(seen.size).toBe(1000);
  });
  it("rejects foreign shapes", () => {
    expect(isQrCodeShape("")).toBe(false);
    expect(isQrCodeShape("abc")).toBe(false);
    expect(isQrCodeShape("000000000000")).toBe(false); // 0 not in alphabet
    expect(isQrCodeShape(null)).toBe(false);
    expect(isQrCodeShape(123456789012)).toBe(false);
  });
});

describe("qr paths", () => {
  it("resolve path carries only the code; menu path carries business + code", () => {
    expect(qrResolvePath("abc234def567")).toBe("/m/abc234def567");
    expect(qrMenuPath("biz1", "abc234def567")).toBe("/menu/biz1?t=abc234def567");
  });
});

describe("deviceClass", () => {
  it("classifies coarse classes only", () => {
    expect(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe("mobile");
    expect(deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15")).toBe("tablet");
    expect(deviceClass("Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 Safari/537.36")).toBe("tablet");
    expect(deviceClass("Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36")).toBe("mobile");
    expect(deviceClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("desktop");
    expect(deviceClass(null)).toBe("unknown");
    expect(deviceClass("")).toBe("unknown");
  });
});

describe("hashSessionAnonId", () => {
  it("is a stable sha256 hex, never the raw id", () => {
    const h = hashSessionAnonId("session-xyz");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashSessionAnonId("session-xyz"));
    expect(h).not.toContain("session-xyz");
    expect(hashSessionAnonId("other")).not.toBe(h);
  });
});

describe("shouldCountEvent (S12 de-duplication)", () => {
  it("counts the first event and suppresses repeats inside the window", () => {
    const t0 = 1_000_000;
    expect(shouldCountEvent(null, t0)).toBe(true);
    expect(shouldCountEvent(t0, t0 + EVENT_DEDUPE_WINDOW_MS - 1)).toBe(false);
    expect(shouldCountEvent(t0, t0 + EVENT_DEDUPE_WINDOW_MS)).toBe(true);
  });
});

const ev = (partial: Partial<RawEvent>): RawEvent => ({ businessId: "b1", type: "scan", createdAt: new Date("2026-11-13T10:00:00Z"), ...partial });

describe("dayKey / dayRange", () => {
  it("uses UTC day boundaries", () => {
    expect(dayKey(new Date("2026-11-13T23:59:59Z"))).toBe("2026-11-13");
    expect(dayKey(new Date("2026-11-13T00:00:00Z"))).toBe("2026-11-13");
    expect(dayRange(3, new Date("2026-11-13T15:00:00Z"))).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(dayRange(1, new Date("2026-01-01T00:30:00Z"))).toEqual(["2026-01-01"]);
  });
});

describe("aggregateEvents", () => {
  it("counts all/table/item dimensions for one day only", () => {
    const rows = aggregateEvents([
      ev({ type: "scan", tableId: "t1" }),
      ev({ type: "scan", tableId: "t1" }),
      ev({ type: "menu_open", tableId: "t1" }),
      ev({ type: "item_view", tableId: "t1", itemId: "i9" }),
      ev({ type: "item_view", itemId: "i9" }),
      ev({ type: "scan", createdAt: new Date("2026-11-12T23:00:00Z") }), // other day — excluded
      ev({ businessId: "b2", type: "scan" }),
    ], "2026-11-13");
    const find = (b: string, m: string, dt: string, di: string) => rows.find((r) => r.businessId === b && r.metric === m && r.dimensionType === dt && r.dimensionId === di)?.count;
    expect(find("b1", "scan", "all", "")).toBe(2);
    expect(find("b1", "scan", "table", "t1")).toBe(2);
    expect(find("b1", "menu_open", "all", "")).toBe(1);
    expect(find("b1", "item_view", "all", "")).toBe(2);
    expect(find("b1", "item_view", "item", "i9")).toBe(2);
    expect(find("b1", "item_view", "table", "t1")).toBe(1);
    expect(find("b2", "scan", "all", "")).toBe(1);
    expect(find("b1", "scan", "item", "i9")).toBeUndefined();
  });
  it("is deterministic under re-run (same input, same rows)", () => {
    const input = [ev({ type: "scan", tableId: "t1" }), ev({ type: "item_view", itemId: "i1" })];
    expect(aggregateEvents(input, "2026-11-13")).toEqual(aggregateEvents(input, "2026-11-13"));
  });
});

describe("buildAnalyticsSummary", () => {
  it("merges stored aggregates with today's rows; byDay fills empty days", () => {
    const days = ["2026-11-12", "2026-11-13"];
    const s = buildAnalyticsSummary({
      days,
      stored: [
        { businessId: "b1", day: "2026-11-12", metric: "scan", dimensionType: "all", dimensionId: "", count: 5 },
        { businessId: "b1", day: "2026-11-12", metric: "scan", dimensionType: "table", dimensionId: "t1", count: 5 },
        { businessId: "b1", day: "2026-11-10", metric: "scan", dimensionType: "all", dimensionId: "", count: 99 }, // outside range
      ],
      today: [
        { businessId: "b1", day: "2026-11-13", metric: "scan", dimensionType: "all", dimensionId: "", count: 2 },
        { businessId: "b1", day: "2026-11-13", metric: "item_view", dimensionType: "item", dimensionId: "i1", count: 3 },
      ],
      tableLabels: { t1: "Table 1" },
      itemNames: { i1: "Biryani" },
    });
    expect(s.totals).toEqual({ scan: 7 });
    expect(s.byDay).toEqual([{ day: "2026-11-12", counts: { scan: 5 } }, { day: "2026-11-13", counts: { scan: 2 } }]);
    expect(s.byTable).toEqual([{ id: "t1", label: "Table 1", counts: { scan: 5 }, total: 5 }]);
    expect(s.byItem).toEqual([{ id: "i1", name: "Biryani", counts: { item_view: 3 }, total: 3 }]);
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines per RFC 4180", () => {
    expect(toCsv([["day", "name"], ["2026-11-13", 'Fish, "special"'], ["2026-11-13", "line\nbreak"]])).toBe('day,name\n2026-11-13,"Fish, ""special"""\n2026-11-13,"line\nbreak"\n');
    expect(toCsv([[1, 2]])).toBe("1,2\n");
  });
});
