import { describe, it, expect } from "vitest";
import { buildBook, resolveGuestView, isLowEndDevice, BOOK_SPREAD_SIZE } from "@/lib/guest-book";
import { GUEST_STRINGS, guestDir, isGuestLang, type GuestStringKey } from "@/lib/guest-i18n";
import type { Product } from "@/lib/demo";

function dish(id: string, category: string, extra: Partial<Product> = {}): Product {
  return {
    id, businessId: "b1", name: `Dish ${id}`, description: "tasty", price: 1000, originalPrice: null,
    category, image: "", photos: [], tags: [], model: null, available: true, isDeal: false,
    dealItems: [], views: 0, ...extra,
  };
}

describe("buildBook", () => {
  it("returns an empty book for no dishes", () => {
    const book = buildBook([], ["Starters"]);
    expect(book.spreads).toEqual([]);
    expect(book.chapters).toEqual([]);
  });

  it("paginates a chapter into spreads of BOOK_SPREAD_SIZE", () => {
    const items = Array.from({ length: 9 }, (_, i) => dish(`m${i}`, "Mains"));
    const book = buildBook(items, ["Mains"]);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]).toMatchObject({ name: "Mains", firstSpread: 0, spreads: 3, dishes: 9 });
    expect(book.spreads.map((s) => s.items.length)).toEqual([4, 4, 1]);
    expect(book.spreads.map((s) => s.pageInChapter)).toEqual([0, 1, 2]);
    expect(book.spreads.every((s) => s.chapterPages === 3)).toBe(true);
    expect(BOOK_SPREAD_SIZE).toBe(4);
  });

  it("keeps the owner's category order and skips empty categories", () => {
    const items = [dish("d1", "Desserts"), dish("s1", "Starters"), dish("s2", "Starters")];
    const book = buildBook(items, ["Starters", "Mains", "Desserts"]);
    expect(book.chapters.map((c) => c.name)).toEqual(["Starters", "Desserts"]);
    expect(book.chapters[1].firstSpread).toBe(1);
  });

  it("puts deals in their own first chapter and never duplicates a dish", () => {
    const deal = dish("deal1", "Mains", { isDeal: true, dealItems: ["x"] });
    const items = [dish("m1", "Mains"), deal, dish("m2", "Mains")];
    const book = buildBook(items, ["Mains"]);
    expect(book.chapters.map((c) => c.name)).toEqual(["Deals", "Mains"]);
    const allIds = book.spreads.flatMap((s) => s.items.map((p) => p.id));
    expect(allIds.sort()).toEqual(["deal1", "m1", "m2"]);
  });

  it("never loses a dish whose category is not in the owner's list", () => {
    const items = [dish("x1", "Secret Menu"), dish("s1", "Starters")];
    const book = buildBook(items, ["Starters"]);
    expect(book.chapters.map((c) => c.name)).toEqual(["Starters", "More from the kitchen"]);
    expect(book.spreads.flatMap((s) => s.items.map((p) => p.id)).sort()).toEqual(["s1", "x1"]);
  });

  it("localises the trailing chapter label when asked", () => {
    const book = buildBook([dish("x1", "???")], ["Starters"], "مزید");
    expect(book.chapters[0].name).toBe("مزید");
  });
});

describe("resolveGuestView", () => {
  it("defaults to the animated book", () => {
    expect(resolveGuestView({})).toBe("book");
    expect(resolveGuestView({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe("book");
  });
  it("honours a stored list choice over everything", () => {
    expect(resolveGuestView({ stored: "list" })).toBe("list");
    expect(resolveGuestView({ stored: "list", reducedMotion: false })).toBe("list");
  });
  it("honours a stored book choice, downgrading only the animation under reduced motion", () => {
    expect(resolveGuestView({ stored: "book" })).toBe("book");
    expect(resolveGuestView({ stored: "book", reducedMotion: true })).toBe("book-static");
    expect(resolveGuestView({ stored: "book", saveData: true })).toBe("book");
  });
  it("sends reduced-motion guests with no stored choice to the list", () => {
    expect(resolveGuestView({ reducedMotion: true })).toBe("list");
  });
  it("gives low-end devices the non-animated book", () => {
    expect(resolveGuestView({ saveData: true })).toBe("book-static");
    expect(resolveGuestView({ deviceMemory: 2 })).toBe("book-static");
    expect(resolveGuestView({ deviceMemory: 1 })).toBe("book-static");
    expect(resolveGuestView({ hardwareConcurrency: 2 })).toBe("book-static");
    expect(resolveGuestView({ deviceMemory: 4, hardwareConcurrency: 4 })).toBe("book");
  });
  it("ignores garbage stored values", () => {
    expect(resolveGuestView({ stored: "banana" })).toBe("book");
    expect(resolveGuestView({ stored: "banana", reducedMotion: true })).toBe("list");
  });
});

describe("isLowEndDevice", () => {
  it("treats unknown signals as not low-end", () => {
    expect(isLowEndDevice({})).toBe(false);
    expect(isLowEndDevice({ deviceMemory: null, hardwareConcurrency: null })).toBe(false);
  });
});

describe("guest i18n", () => {
  it("has exactly the same keys in English and Urdu", () => {
    const en = Object.keys(GUEST_STRINGS.en).sort();
    const ur = Object.keys(GUEST_STRINGS.ur).sort();
    expect(ur).toEqual(en);
    expect(en.length).toBeGreaterThan(15);
  });
  it("actually translates (Urdu values differ and use Urdu script)", () => {
    (Object.keys(GUEST_STRINGS.en) as GuestStringKey[]).forEach((key) => {
      expect(GUEST_STRINGS.ur[key]).not.toBe(GUEST_STRINGS.en[key]);
      expect(GUEST_STRINGS.ur[key]).toMatch(/[؀-ۿ]/);
    });
  });
  it("maps direction and validates language codes", () => {
    expect(guestDir("en")).toBe("ltr");
    expect(guestDir("ur")).toBe("rtl");
    expect(isGuestLang("ur")).toBe(true);
    expect(isGuestLang("fr")).toBe(false);
    expect(isGuestLang(null)).toBe(false);
  });
});
