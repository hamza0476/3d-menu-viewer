// Phase 6 (Pakistan pack, fixes G8): the seeded demo restaurant is now a
// fictional Lahori kitchen — every dish carries its Urdu name/description,
// a spice level and a serves note, in PKR. Clearly demo data: the name,
// address and phone are invented (the 555 number is the fictional range).
export const SPICE_LEVELS = ['none', 'mild', 'medium', 'hot', 'extra-hot'] as const;
export type SpiceLevel = typeof SPICE_LEVELS[number];
export const SPICE_LEVEL_LABELS: Record<SpiceLevel, { en: string; ur: string }> = {
  'none': { en: 'No spice', ur: 'بغیر مرچ' },
  'mild': { en: 'Mild', ur: 'ہلکی مرچ' },
  'medium': { en: 'Medium', ur: 'درمیانی مرچ' },
  'hot': { en: 'Hot', ur: 'تیز مرچ' },
  'extra-hot': { en: 'Extra hot', ur: 'بہت تیز مرچ' },
};
export const demoProducts = [
 { name: 'Seekh Kebab (4 pcs)', nameUr: 'سیخ کباب (۴ عدد)', description: 'Char-grilled minced beef kebabs with green chillies, fresh coriander and a squeeze of lemon.', descriptionUr: 'کوئلے پر گرل کیے گئے قیمے کے کباب، ہری مرچ، تازہ دھنیا اور لیموں کے ساتھ۔', price: 65000, category: 'Starters', image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=900&q=85', views: 186, tags: ['halal', 'spicy'], spiceLevel: 'medium', serves: 'Serves 1–2' },
 { name: 'Chicken Karahi', nameUr: 'چکن کڑاہی', description: 'Wok-tossed chicken with fresh tomatoes, green chillies and ginger — the Food Street favourite, served bubbling in the karahi.', descriptionUr: 'تازہ ٹماٹر، ہری مرچ اور ادرک کے ساتھ کڑاہی میں بنا چکن — فوڈ اسٹریٹ کی پہچان، اسی کڑاہی میں پیش کیا جاتا ہے۔', price: 145000, category: 'Karahi & Handi', image: 'https://images.unsplash.com/photo-1606491956689-2ea866880c84?auto=format&fit=crop&w=900&q=85', views: 248, tags: ['halal', 'spicy'], spiceLevel: 'hot', serves: 'Serves 2–3' },
 { name: 'Chicken Biryani', nameUr: 'چکن بریانی', description: 'Layered basmati rice with spiced chicken, aloo and raita on the side. Friday sells out first.', descriptionUr: 'مصالحے دار چکن، آلو اور رائتے کے ساتھ تہہ دار باسمتی چاول۔ جمعہ کو سب سے پہلے ختم ہوتی ہے۔', price: 45000, category: 'Biryani & Rice', image: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=900&q=85', views: 214, tags: ['halal', 'spicy'], spiceLevel: 'hot', serves: 'Serves 1' },
 { name: 'Garlic Naan', nameUr: 'لہسن والا نان', description: 'Tandoor-fresh naan brushed with garlic butter and coriander.', descriptionUr: 'تندور کا تازہ نان، لہسن مکھن اور دھنیا کے ساتھ۔', price: 12000, category: 'Breads', image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=900&q=85', views: 172, tags: ['vegetarian', 'gluten'], spiceLevel: 'none', serves: '1 piece' },
 { name: 'Kulfi Falooda', nameUr: 'قلفی فالودہ', description: 'Dense traditional kulfi over falooda noodles with basil seeds and rose syrup.', descriptionUr: 'روایتی قلفی، فالودہ، تخم بالنگا اور روح افزا شربت کے ساتھ۔', price: 38000, category: 'Desserts', image: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=900&q=85', views: 128, tags: ['vegetarian', 'milk'], spiceLevel: 'none', serves: 'Serves 1' },
 { name: 'Mint Margarita', nameUr: 'منٹ مارگریٹا', description: 'Sparkling lemon and mint cooler — the karahi’s best friend.', descriptionUr: 'لیموں اور پودینے کا ٹھنڈا مشروب — کڑاہی کا بہترین ساتھی۔', price: 25000, category: 'Drinks', image: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?auto=format&fit=crop&w=900&q=85', views: 94, tags: ['vegan', 'gluten-free'], spiceLevel: 'none', serves: 'Serves 1' },
];
export const DEFAULT_CATEGORIES = ['Starters', 'Main courses', 'Desserts', 'Drinks'];
export const DEALS_CATEGORY = 'Deals';
export const CURRENCIES = [
 { code: 'USD', label: 'US Dollar', region: 'United States', locale: 'en-US' },
 { code: 'PKR', label: 'Pakistani Rupee', region: 'Pakistan', locale: 'ur-PK' },
 { code: 'INR', label: 'Indian Rupee', region: 'India', locale: 'en-IN' },
 { code: 'AUD', label: 'Australian Dollar', region: 'Australia', locale: 'en-AU' },
 { code: 'EUR', label: 'Euro', region: 'Europe', locale: 'en-IE' },
 { code: 'GBP', label: 'British Pound', region: 'United Kingdom', locale: 'en-GB' },
 { code: 'SAR', label: 'Saudi Riyal', region: 'Saudi Arabia', locale: 'en-SA' },
 { code: 'AED', label: 'UAE Dirham', region: 'United Arab Emirates', locale: 'en-AE' },
 { code: 'QAR', label: 'Qatari Riyal', region: 'Qatar', locale: 'en-QA' },
 { code: 'KWD', label: 'Kuwaiti Dinar', region: 'Kuwait', locale: 'en-KW' },
 { code: 'BHD', label: 'Bahraini Dinar', region: 'Bahrain', locale: 'en-BH' },
 { code: 'OMR', label: 'Omani Rial', region: 'Oman', locale: 'en-OM' },
] as const;
export type CurrencyCode = typeof CURRENCIES[number]['code'];
export const CURRENCY_CODES = CURRENCIES.map(c => c.code) as CurrencyCode[];
export const DISH_TAGS = [
 { id: 'vegetarian', label: 'Vegetarian', group: 'diet' },
 { id: 'vegan', label: 'Vegan', group: 'diet' },
 { id: 'halal', label: 'Halal', group: 'diet' },
 { id: 'gluten-free', label: 'Gluten-free', group: 'diet' },
 { id: 'dairy-free', label: 'Dairy-free', group: 'diet' },
 { id: 'spicy', label: 'Spicy', group: 'diet' },
 { id: 'gluten', label: 'Gluten', group: 'allergen' },
 { id: 'crustaceans', label: 'Crustaceans', group: 'allergen' },
 { id: 'egg', label: 'Egg', group: 'allergen' },
 { id: 'fish', label: 'Fish', group: 'allergen' },
 { id: 'peanuts', label: 'Peanuts', group: 'allergen' },
 { id: 'soy', label: 'Soy', group: 'allergen' },
 { id: 'milk', label: 'Milk', group: 'allergen' },
 { id: 'tree-nuts', label: 'Tree nuts', group: 'allergen' },
 { id: 'celery', label: 'Celery', group: 'allergen' },
 { id: 'mustard', label: 'Mustard', group: 'allergen' },
 { id: 'sesame', label: 'Sesame', group: 'allergen' },
 { id: 'sulphites', label: 'Sulphites', group: 'allergen' },
 { id: 'lupin', label: 'Lupin', group: 'allergen' },
 { id: 'molluscs', label: 'Molluscs', group: 'allergen' },
] as const;
export type DishTagId = typeof DISH_TAGS[number]['id'];
export const DISH_TAG_IDS = DISH_TAGS.map(t => t.id) as DishTagId[];
export const dishTagLabel = (id: string) => DISH_TAGS.find(t => t.id === id)?.label || id;
export type Product = { id: string; businessId: string; name: string; description: string; price: number; originalPrice: number | null; category: string; image: string; photos: string[]; tags: string[]; model: string | null; model3d?: Model3d | null; available: boolean; isDeal: boolean; dealItems: string[]; views: number; createdAt?: string; nameUr?: string | null; descriptionUr?: string | null; spiceLevel?: string | null; serves?: string | null };
// Phase 4: the processed-model bundle the guest API attaches when an
// item's pipeline run is ready — poster first, low variant for the first
// render, high variant as the progressive upgrade, USDZ for iOS Quick
// Look. Any entry may be null (e.g. no poster was produced).
export type Model3d = { poster: string | null; low: string | null; high: string | null; usdz: string | null; lowBytes: number | null; highBytes: number | null };
export type Business = { id: string; name: string; tagline: string; city: string; province: string; address: string; phone: string; currency: CurrencyCode; published: boolean; suspended: boolean; categories: string[]; categoriesUr?: (string | null)[] | null };
export type Workspace = { user: { name: string; email: string; demo: boolean; emailVerified: boolean }; role?: 'owner' | 'manager' | 'staff'; business: Business; products: Product[]; activities: { id: string; text: string; type: string; createdAt: string }[] };
