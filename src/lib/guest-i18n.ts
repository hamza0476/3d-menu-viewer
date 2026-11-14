// Guest-menu chrome strings (Phase 5 — fixes part of G1's Urdu gap).
//
// Scope, deliberately: this dictionary covers the SHARED guest chrome —
// the book cover, chapter thumb index, page controls, the table-context
// banner, the view/language toggles and the dish detail sheet. Dish
// names, descriptions and category names are OWNER data: they render
// exactly as the owner typed them (with dir="auto" in the components, so
// Urdu text an owner already typed renders RTL today). Full Urdu data
// fields across the dashboard are Phase 6; nothing here pretends a dish
// has an Urdu name when the owner never entered one.
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
