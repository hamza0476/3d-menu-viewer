// Guest-menu chrome strings (Phase 5 — fixes part of G1's Urdu gap).
//
// This dictionary covers the SHARED guest chrome — the book cover,
// chapter thumb index, page controls, the table-context banner, the
// view/language toggles and the dish detail sheet. Phase 6 completed the
// content side: dishes and categories now carry owner-entered Urdu
// fields (products.name_ur/description_ur, businesses.categories_ur) and
// the helpers at the bottom of this file resolve them per field —
// Urdu when the guest picked Urdu AND the owner entered it, English
// otherwise. Nothing here invents an Urdu name the owner never typed.
export const GUEST_LANGS = ["en", "ur"] as const;
export type GuestLang = (typeof GUEST_LANGS)[number];

export const GUEST_STRINGS = {
  en: {
    welcomeToYourTable: "Welcome to your table",
    tapToOpen: "Tap to open",
    youreAt: "You're at",
    chapters: "Chapters",
    bookView: "Book view",
    listView: "List view",
    searchDishes: "Search dishes",
    viewIn3d: "View in 3D",
    illustrative3d: "Illustrative 3D preview",
    dealIncludes: "See what's included",
    takeCloserLook: "Take a closer look",
    dish: "dish",
    dishes: "dishes",
    nextPage: "Next page",
    prevPage: "Previous page",
    page: "Page",
    of: "of",
    moreFromTheKitchen: "More from the kitchen",
    addToFavorites: "Add to favorites",
    removeFromFavorites: "Remove from favorites",
    goodFor: "Good for",
    contains: "Contains",
    allergenNote: "Dietary tags are set by the restaurant as a helpful guide — please still let your server know about any allergies.",
    deals: "Deals",
    serves: "Serves",
    spiceLevel: "Spice level",
    pricesIn: "Prices in",
    close: "Close",
    languageName: "English",
  },
  ur: {
    welcomeToYourTable: "آپ کی میز پر خوش آمدید",
    tapToOpen: "کھولنے کے لیے تھپتھپائیں",
    youreAt: "آپ ہیں",
    chapters: "ابواب",
    bookView: "کتابی منظر",
    listView: "فہرست منظر",
    searchDishes: "کھانا تلاش کریں",
    viewIn3d: "تھری ڈی میں دیکھیں",
    illustrative3d: "تھری ڈی نمونہ منظر",
    dealIncludes: "دیکھیں اس میں کیا شامل ہے",
    takeCloserLook: "قریب سے دیکھیں",
    dish: "کھانا",
    dishes: "کھانے",
    nextPage: "اگلا صفحہ",
    prevPage: "پچھلا صفحہ",
    page: "صفحہ",
    of: "از",
    moreFromTheKitchen: "باورچی خانے سے مزید",
    addToFavorites: "پسندیدہ میں شامل کریں",
    removeFromFavorites: "پسندیدہ سے ہٹائیں",
    goodFor: "مناسب برائے",
    contains: "شامل ہے",
    allergenNote: "غذائی نشانات ریستوران کی طرف سے رہنمائی کے لیے ہیں — براہ کرم کسی بھی الرجی کے بارے میں اپنے ویٹر کو ضرور بتائیں۔",
    deals: "ڈیلز",
    serves: "افراد",
    spiceLevel: "مرچ کی مقدار",
    pricesIn: "قیمتیں بذریعہ",
    close: "بند کریں",
    languageName: "اردو",
  },
} as const;

export type GuestStringKey = keyof (typeof GUEST_STRINGS)["en"];
export type GuestStrings = Record<GuestStringKey, string>;

export function guestStrings(lang: GuestLang): GuestStrings {
  return GUEST_STRINGS[lang];
}

export function isGuestLang(value: unknown): value is GuestLang {
  return value === "en" || value === "ur";
}

/** Text direction for the guest chrome in a language. */
export function guestDir(lang: GuestLang): "ltr" | "rtl" {
  return lang === "ur" ? "rtl" : "ltr";
}

// ---------------------------------------------------------------------------
// Phase 6 content localization: owner-entered Urdu fields with per-field
// English fallback. Pure functions — unit-tested.
import { SPICE_LEVEL_LABELS, type Product, type SpiceLevel } from "@/lib/demo";

export function localizedDishName(product: Product, lang: GuestLang): string {
  return lang === "ur" && product.nameUr ? product.nameUr : product.name;
}

export function localizedDishDescription(product: Product, lang: GuestLang): string {
  return lang === "ur" && product.descriptionUr ? product.descriptionUr : product.description;
}

/** Urdu name for an owner category, aligned by index; English fallback. */
export function localizedCategory(name: string, categories: string[], categoriesUr: (string | null)[] | null | undefined, lang: GuestLang): string {
  if (lang !== "ur" || !categoriesUr) return name;
  const idx = categories.indexOf(name);
  return idx >= 0 && categoriesUr[idx] ? (categoriesUr[idx] as string) : name;
}

/** Localized spice-level label, or null when the dish has none set. */
export function spiceLabel(level: string | null | undefined, lang: GuestLang): string | null {
  if (!level || !(level in SPICE_LEVEL_LABELS)) return null;
  return SPICE_LEVEL_LABELS[level as SpiceLevel][lang];
}
