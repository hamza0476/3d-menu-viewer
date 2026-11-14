// Book-menu structure + guest view resolution (Phase 5 — fixes G1).
//
// The guest menu becomes a book: a cover, then one chapter per category,
// each chapter paginated into spreads. This module is the pure,
// unit-tested core — components render what it returns.
//
// Pagination: BOOK_SPREAD_SIZE dishes per spread (a 2x2 grid on a phone
// held portrait reads like a menu page; larger grids made pages feel
// like the old scrolling list). Deals get their own first chapter when
// any exist (mirroring the list view's Deals tab), then the restaurant's
// categories in the owner's order, then anything whose category is not
// in the owner's list under one trailing chapter — a dish can never be
// lost by the book just because its category was renamed.
import { DEALS_CATEGORY, type Product } from "@/lib/demo";

export const BOOK_SPREAD_SIZE = 4;

export type BookSpread = {
  /** Stable index across the whole book (cover excluded). */
  index: number;
  chapter: string;
  /** 0-based position of this spread inside its chapter. */
  pageInChapter: number;
  /** How many spreads the chapter has in total. */
  chapterPages: number;
  items: Product[];
};

export type BookChapter = {
  name: string;
  /** Index of the chapter's first spread in the flat spread list. */
  firstSpread: number;
  spreads: number;
  dishes: number;
};

export type BookStructure = {
  spreads: BookSpread[];
  chapters: BookChapter[];
};

export function buildBook(products: Product[], categories: string[], moreLabel = "More from the kitchen"): BookStructure {
  const groups: { name: string; items: Product[] }[] = [];
  const used = new Set<string>();

  const deals = products.filter((p) => p.isDeal);
  if (deals.length) {
    groups.push({ name: DEALS_CATEGORY, items: deals });
    deals.forEach((p) => used.add(p.id));
  }
  for (const category of categories) {
    const items = products.filter((p) => !used.has(p.id) && p.category === category);
    if (items.length) {
      groups.push({ name: category, items });
      items.forEach((p) => used.add(p.id));
    }
  }
  const leftovers = products.filter((p) => !used.has(p.id));
  if (leftovers.length) groups.push({ name: moreLabel, items: leftovers });

  const spreads: BookSpread[] = [];
  const chapters: BookChapter[] = [];
  for (const group of groups) {
    const chunks: Product[][] = [];
    for (let i = 0; i < group.items.length; i += BOOK_SPREAD_SIZE) chunks.push(group.items.slice(i, i + BOOK_SPREAD_SIZE));
    chapters.push({ name: group.name, firstSpread: spreads.length, spreads: chunks.length, dishes: group.items.length });
    chunks.forEach((items, pageInChapter) => {
      spreads.push({ index: spreads.length, chapter: group.name, pageInChapter, chapterPages: chunks.length, items });
    });
  }
  return { spreads, chapters };
}

// ---------------------------------------------------------------------------
// View resolution: which guest experience a device/session gets.
//
// The book is the default. The exceptions are deliberate and ordered:
//   1. An explicit stored choice always wins — except that a stored
//      "book" under reduced-motion becomes the non-animated book
//      (book-static): the guest chose the book, the OS asked for no
//      animation; both are honoured.
//   2. Reduced motion with no stored choice -> the classic list (the
//      plan's non-negotiable fallback).
//   3. Low-end signals (data-saver on, <=2 GB device memory, <=2 cores)
//      -> book-static: same book, no flip animation, spreads stacked
//      with tap-to-jump chapters.
//   4. Otherwise the animated book.
export type GuestViewMode = "book" | "book-static" | "list";

export type ViewSignals = {
  stored?: string | null;
  reducedMotion?: boolean;
  saveData?: boolean;
  deviceMemory?: number | null;
  hardwareConcurrency?: number | null;
};

export function isLowEndDevice(signals: ViewSignals): boolean {
  if (signals.saveData) return true;
  if (typeof signals.deviceMemory === "number" && signals.deviceMemory <= 2) return true;
  if (typeof signals.hardwareConcurrency === "number" && signals.hardwareConcurrency <= 2) return true;
  return false;
}

export function resolveGuestView(signals: ViewSignals): GuestViewMode {
  if (signals.stored === "list") return "list";
  if (signals.stored === "book") return signals.reducedMotion ? "book-static" : "book";
  if (signals.reducedMotion) return "list";
  if (isLowEndDevice(signals)) return "book-static";
  return "book";
}
