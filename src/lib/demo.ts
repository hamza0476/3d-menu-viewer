export const demoProducts = [
 { name: 'Avocado & grain bowl', description: 'A feel-good bowl of creamy avocado, quinoa, roasted chickpeas and seasonal greens, finished with lemon tahini.', price: 1650, category: 'Main courses', image: 'https://images.pexels.com/photos/1484522/pexels-photo-1484522.jpeg?auto=compress&cs=tinysrgb&w=900', views: 248, tags: ['vegan', 'gluten-free'] },
 { name: 'Burrata & heirloom tomatoes', description: 'Creamy burrata, sun-ripened heirloom tomatoes, fresh basil and a drizzle of extra virgin olive oil.', price: 1400, category: 'Starters', image: 'https://images.pexels.com/photos/3669501/pexels-photo-3669501.jpeg?auto=compress&cs=tinysrgb&w=900', views: 186, tags: ['vegetarian', 'gluten-free', 'milk'] },
 { name: 'Wild mushroom pasta', description: 'Fresh ribbon pasta with woodland mushrooms, parmesan, thyme and a silky truffle cream sauce.', price: 2200, category: 'Main courses', image: 'https://images.unsplash.com/photo-1473093226795-af9932fe5856?auto=format&fit=crop&w=900&q=85', views: 214, tags: ['vegetarian', 'gluten', 'milk', 'egg'] },
 { name: 'The house cheeseburger', description: 'A flame-grilled beef patty, aged cheddar, crisp lettuce and house sauce in a toasted brioche bun.', price: 1850, category: 'Main courses', image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=85', views: 172, tags: ['gluten', 'milk', 'mustard'] },
 { name: 'Berry cheesecake', description: 'Our signature baked vanilla cheesecake with a buttery biscuit base and a fresh summer berry compote.', price: 950, category: 'Desserts', image: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=900&q=85', views: 128, tags: ['vegetarian', 'gluten', 'milk', 'egg'] },
 { name: 'Iced matcha latte', description: 'Ceremonial-grade matcha whisked with oat milk and poured over ice. Naturally refreshing.', price: 650, category: 'Drinks', image: 'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=900&q=85', views: 94, tags: ['vegan', 'dairy-free', 'gluten-free'] }
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
export type Product = { id: string; businessId: string; name: string; description: string; price: number; originalPrice: number | null; category: string; image: string; photos: string[]; tags: string[]; model: string | null; available: boolean; isDeal: boolean; dealItems: string[]; views: number; createdAt?: string };
export type Business = { id: string; name: string; tagline: string; city: string; province: string; address: string; phone: string; currency: CurrencyCode; published: boolean; suspended: boolean; categories: string[] };
export type Workspace = { user: { name: string; email: string; demo: boolean; emailVerified: boolean }; business: Business; products: Product[]; activities: { id: string; text: string; type: string; createdAt: string }[] };
