// Pakistan onboarding templates (Phase 6, fixes G8). A new restaurant
// picks the set closest to its kitchen at signup (or later, from
// Settings) instead of starting from the generic Western defaults.
// Each template pairs English categories with their Urdu names — index i
// of `categoriesUr` is the Urdu name for index i of `categories` — so the
// guest book/list can render Urdu category headings from day one.
export type PkTemplate = {
  id: string;
  label: string;
  labelUr: string;
  categories: string[];
  categoriesUr: string[];
};

export const PK_TEMPLATES: Record<string, PkTemplate> = {
  desi: {
    id: "desi",
    label: "Desi / Pakistani",
    labelUr: "دیسی / پاکستانی",
    categories: ["Starters", "Karahi & Handi", "Biryani & Rice", "Breads", "Desserts", "Drinks"],
    categoriesUr: ["اسٹارٹرز", "کڑاہی اور ہانڈی", "بریانی اور چاول", "روٹیاں", "میٹھا", "مشروبات"],
  },
  bbq: {
    id: "bbq",
    label: "BBQ & Grill",
    labelUr: "باربی کیو اور گرل",
    categories: ["Starters", "BBQ Platters", "Kebabs & Tikka", "Breads", "Desserts", "Drinks"],
    categoriesUr: ["اسٹارٹرز", "بی بی کیو پلیٹرز", "کباب اور ٹکا", "روٹیاں", "میٹھا", "مشروبات"],
  },
  "fast-food": {
    id: "fast-food",
    label: "Fast Food",
    labelUr: "فاسٹ فوڈ",
    categories: ["Burgers", "Fried Chicken", "Pizza", "Sides", "Shakes & Drinks", "Desserts"],
    categoriesUr: ["برگرز", "فرائیڈ چکن", "پیزا", "سائیڈز", "شیکس اور مشروبات", "میٹھا"],
  },
  cafe: {
    id: "cafe",
    label: "Café & Bakery",
    labelUr: "کیفے اور بیکری",
    categories: ["Breakfast", "Sandwiches & Wraps", "Bakery", "Desserts", "Coffee & Tea", "Cold Drinks"],
    categoriesUr: ["ناشتہ", "سینڈوچ اور ریپس", "بیکری", "میٹھا", "کافی اور چائے", "ٹھنڈے مشروبات"],
  },
};

export const PK_TEMPLATE_IDS = Object.keys(PK_TEMPLATES);
export function isTemplateId(value: unknown): value is string {
  return typeof value === "string" && value in PK_TEMPLATES;
}
