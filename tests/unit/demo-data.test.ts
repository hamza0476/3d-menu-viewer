import { describe, it, expect } from "vitest";
import { CURRENCY_CODES, DISH_TAG_IDS, dishTagLabel } from "@/lib/demo";

describe("menu reference data", () => {
  it("supports PKR pricing (the pilot market is Pakistan)", () => {
    expect(CURRENCY_CODES).toContain("PKR");
  });

  it("has unique dish tag ids and a label for every tag", () => {
    expect(new Set(DISH_TAG_IDS).size).toBe(DISH_TAG_IDS.length);
    for (const id of DISH_TAG_IDS) {
      expect(dishTagLabel(id)).not.toBe("");
      // A known tag must resolve to a human label, not echo its raw id.
      expect(dishTagLabel(id)).not.toBe(id);
    }
  });

  it("falls back to the raw id for an unknown tag", () => {
    expect(dishTagLabel("not-a-real-tag")).toBe("not-a-real-tag");
  });
});
