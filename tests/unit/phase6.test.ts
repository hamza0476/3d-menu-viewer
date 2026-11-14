import { describe, expect, it } from "vitest";
import { roleAllowed, ROLE_RANK } from "@/lib/tenancy";
import { PK_TEMPLATES, PK_TEMPLATE_IDS, isTemplateId } from "@/lib/pk-templates";
import { localizedCategory, localizedDishDescription, localizedDishName, spiceLabel } from "@/lib/guest-i18n";
import { buildBook } from "@/lib/guest-book";
import { SPICE_LEVELS, SPICE_LEVEL_LABELS, type Product } from "@/lib/demo";

// Phase 6 pure logic: the role ladder, the Pakistan templates, and the
// guest-side Urdu localization helpers (per-field English fallback).

describe("role ladder (plan §6)", () => {
  it("ranks owner > manager > staff", () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.manager);
    expect(ROLE_RANK.manager).toBeGreaterThan(ROLE_RANK.staff);
  });
  it("roleAllowed implements the full matrix", () => {
    expect(roleAllowed("owner", "owner")).toBe(true);
    expect(roleAllowed("owner", "manager")).toBe(true);
    expect(roleAllowed("owner", "staff")).toBe(true);
    expect(roleAllowed("manager", "owner")).toBe(false);
    expect(roleAllowed("manager", "manager")).toBe(true);
    expect(roleAllowed("manager", "staff")).toBe(true);
    expect(roleAllowed("staff", "owner")).toBe(false);
    expect(roleAllowed("staff", "manager")).toBe(false);
    expect(roleAllowed("staff", "staff")).toBe(true);
  });
});

describe("Pakistan onboarding templates", () => {
  it("ships the four plan sets: desi, bbq, fast-food, cafe", () => {
    expect(PK_TEMPLATE_IDS.sort()).toEqual(["bbq", "cafe", "desi", "fast-food"]);
    expect(isTemplateId("desi")).toBe(true);
    expect(isTemplateId("french")).toBe(false);
    expect(isTemplateId(undefined)).toBe(false);
  });
  it("every template's Urdu array is index-aligned and complete", () => {
    for (const t of Object.values(PK_TEMPLATES)) {
      expect(t.categoriesUr.length).toBe(t.categories.length);
      expect(t.categoriesUr.every((u) => typeof u === "string" && u.length > 0)).toBe(true);
      expect(t.categories.length).toBeGreaterThanOrEqual(5);
    }
  });
  it("the desi set leads with the karahi chapter the demo menu uses", () => {
    expect(PK_TEMPLATES.desi.categories).toContain("Karahi & Handi");
    expect(PK_TEMPLATES.desi.categoriesUr[PK_TEMPLATES.desi.categories.indexOf("Karahi & Handi")]).toBe("کڑاہی اور ہانڈی");
  });
});

const dish = (over: Partial<Product>): Product => ({
  id: "p1", businessId: "b1", name: "Chicken Karahi", description: "Wok-tossed chicken.",
  nameUr: "چکن کڑاہی", descriptionUr: "کڑاہی میں بنا چکن۔",
  price: 145000, originalPrice: null, category: "Karahi & Handi", image: "", photos: [],
  tags: [], model: null, available: true, isDeal: false, dealItems: [], views: 0,
  spiceLevel: "hot", serves: "Serves 2–3", ...over,
});

describe("Urdu dish localization — per-field English fallback", () => {
  it("uses Urdu fields when the guest picked Urdu and the owner entered them", () => {
    expect(localizedDishName(dish({}), "ur")).toBe("چکن کڑاہی");
    expect(localizedDishDescription(dish({}), "ur")).toBe("کڑاہی میں بنا چکن۔");
  });
  it("falls back per field: Urdu name but English description when only the name was entered", () => {
    const p = dish({ descriptionUr: null });
    expect(localizedDishName(p, "ur")).toBe("چکن کڑاہی");
    expect(localizedDishDescription(p, "ur")).toBe("Wok-tossed chicken.");
  });
  it("falls back entirely when the owner entered no Urdu", () => {
    const p = dish({ nameUr: null, descriptionUr: null });
    expect(localizedDishName(p, "ur")).toBe("Chicken Karahi");
    expect(localizedDishDescription(p, "ur")).toBe("Wok-tossed chicken.");
  });
  it("never localizes for English guests", () => {
    expect(localizedDishName(dish({}), "en")).toBe("Chicken Karahi");
    expect(localizedDishDescription(dish({}), "en")).toBe("Wok-tossed chicken.");
  });
});

describe("Urdu category localization — index-aligned with fallback", () => {
  const cats = ["Starters", "Karahi & Handi", "Drinks"];
  const catsUr = ["اسٹارٹرز", "کڑاہی اور ہانڈی", null];
  it("resolves the Urdu name by index", () => {
    expect(localizedCategory("Karahi & Handi", cats, catsUr, "ur")).toBe("کڑاہی اور ہانڈی");
  });
  it("falls back to English when that index has no Urdu name", () => {
    expect(localizedCategory("Drinks", cats, catsUr, "ur")).toBe("Drinks");
  });
  it("falls back when there is no Urdu array at all, and for English guests", () => {
    expect(localizedCategory("Starters", cats, null, "ur")).toBe("Starters");
    expect(localizedCategory("Starters", cats, catsUr, "en")).toBe("Starters");
  });
  it("unknown categories pass through untouched", () => {
    expect(localizedCategory("Chef's Specials", cats, catsUr, "ur")).toBe("Chef's Specials");
  });
});

describe("spice labels", () => {
  it("every level has both labels and resolves per language", () => {
    for (const level of SPICE_LEVELS) {
      expect(spiceLabel(level, "en")).toBe(SPICE_LEVEL_LABELS[level].en);
      expect(spiceLabel(level, "ur")).toBe(SPICE_LEVEL_LABELS[level].ur);
    }
    expect(spiceLabel("hot", "ur")).toBe("تیز مرچ");
  });
  it("returns null for unset or invalid levels", () => {
    expect(spiceLabel(null, "en")).toBeNull();
    expect(spiceLabel(undefined, "ur")).toBeNull();
    expect(spiceLabel("nuclear", "en")).toBeNull();
  });
});

describe("buildBook chapter localization (Phase 6 hook)", () => {
  const items = [dish({}), dish({ id: "p2", isDeal: true, name: "Duo" })];
  it("without a localizer the chapters keep their English names (Phase 5 behaviour)", () => {
    const book = buildBook(items, ["Karahi & Handi"], "More");
    expect(book.chapters.map((c) => c.name)).toEqual(["Deals", "Karahi & Handi"]);
  });
  it("with a localizer, deals and category chapters are localized", () => {
    const book = buildBook(items, ["Karahi & Handi"], "مزید", (n) => (n === "Deals" ? "ڈیلز" : "کڑاہی اور ہانڈی"));
    expect(book.chapters.map((c) => c.name)).toEqual(["ڈیلز", "کڑاہی اور ہانڈی"]);
    expect(book.spreads.every((s) => s.chapter === "ڈیلز" || s.chapter === "کڑاہی اور ہانڈی")).toBe(true);
  });
});
