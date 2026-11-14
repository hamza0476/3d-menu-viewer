import { db } from '@/db';
import { users, sessions, businesses, products, activities, verificationTokens, memberships } from '@/db/schema';
import { cookies, headers } from 'next/headers';
import { rateLimit, clientIp } from './rate-limit';
import { eq, and, gt } from 'drizzle-orm';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import { demoProducts } from './demo';
import { PK_TEMPLATES } from './pk-templates';
export const uid = () => randomBytes(12).toString('hex');
// Session and verification tokens are stored in the database ONLY as SHA-256
// hashes. The raw token exists solely in the user's cookie / emailed link, so
// a database leak does not hand an attacker usable sessions or reset links.
// (Deploying this change invalidates any previously issued raw-token rows:
// existing sessions and outstanding email links stop working once, by design.)
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function hashPassword(password: string) { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); }
export function verifyPassword(password: string, stored: string) { const [salt, hash] = stored.split(':'); if (!salt || !hash) return false; const input = scryptSync(password, salt, 64); const expected = Buffer.from(hash, 'hex'); return input.length === expected.length && timingSafeEqual(input, expected); }
export async function getUser() { const token = (await cookies()).get('platera_session')?.value; if (!token) return null; const [row] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.token, hashToken(token)), gt(sessions.expires, new Date()))); return row?.user ?? null; }
export async function setSession(userId: string, days = 30) { const token = randomBytes(32).toString('hex'); await db.insert(sessions).values({ token: hashToken(token), userId, expires: new Date(Date.now() + days * 86400000) }); (await cookies()).set('platera_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: days * 86400 }); }
// Thrown when an anonymous visitor's connection has created too many demo
// workspaces; the workspace route turns this into a 429.
export class DemoCreationLimitError extends Error { constructor() { super('Too many demo workspaces created from this connection. Please sign up or try again later.'); } }
export async function seedBusiness(ownerId: string, name = 'Zaiqa Dastarkhwan', templateId?: string) {
  const id = uid();
  // Phase 6 (Pakistan pack, fixes G8): the seeded/demo restaurant is a
  // fictional Lahori kitchen — invented name, address and a 555-range
  // (fictional) phone — priced in PKR, with the Desi template's
  // categories (or the template the owner picked at signup).
  const template = (templateId && PK_TEMPLATES[templateId]) || PK_TEMPLATES.desi;
  await db.insert(businesses).values({ id, ownerId, name, tagline: 'Asli Lahori zaika — karahi, biryani aur BBQ, fresh from the karahi.', city: 'Lahore', province: 'Punjab', address: '12 Food Street, Gawalmandi', phone: '+92 300 555 0142', currency: 'PKR', categories: [...template.categories], categoriesUr: [...template.categoriesUr], published: true });
  // Phase 6: the owner always holds an 'owner' membership row — the
  // memberships-backed guard (lib/tenancy) resolves workspaces through it.
  await db.insert(memberships).values({ id: uid(), userId: ownerId, businessId: id, role: 'owner' });
  const seeded = demoProducts.map(p => ({ ...p, id: uid(), businessId: id, photos: [] as string[], model: null as string | null, originalPrice: null as number | null, isDeal: false, dealItems: [] as string[] }));
  const karahi = seeded.find(p => p.name === 'Chicken Karahi');
  const kulfi = seeded.find(p => p.name === 'Kulfi Falooda');
  if (karahi) karahi.originalPrice = 165000; // shows a strikethrough "was" price on a regular item
  const dealPrice = karahi && kulfi ? Math.round((karahi.price + kulfi.price) * 0.85) : 155000;
  const deal = karahi && kulfi ? [{
    id: uid(), businessId: id, name: 'Karahi & kulfi duo', nameUr: 'کڑاہی اور قلفی ڈو', description: 'Our signature chicken karahi with a kulfi falooda to finish, together for less.', descriptionUr: 'ہماری خاص چکن کڑاہی اور آخر میں قلفی فالودہ — دونوں ایک ساتھ کم قیمت میں۔', price: dealPrice, originalPrice: karahi.price + kulfi.price, category: 'Deals', image: karahi.image, photos: [] as string[], tags: [] as string[], model: null as string | null, available: true, isDeal: true, dealItems: [karahi.id, kulfi.id], views: 61, spiceLevel: 'hot', serves: 'Serves 2–3',
  }] : [];
  await db.insert(products).values([...seeded, ...deal]);
  await db.insert(activities).values([{ id: uid(), businessId: id, text: 'Your digital menu is live. Welcome to Platera!', type: 'publish' }, { id: uid(), businessId: id, text: '6 delicious dishes added to your menu', type: 'product' }, { id: uid(), businessId: id, text: 'Your restaurant profile is ready to personalize', type: 'business' }]);
  return id;
}
export async function ensureUser() { const existing = await getUser(); if (existing) return existing; const ip = clientIp({ headers: await headers() }); if (!(await rateLimit(`demo-create:${ip}`, 5, 3600000)).allowed) throw new DemoCreationLimitError(); const id = uid(); const user = { id, name: 'Alex Morgan', email: `demo-${id}@platera.local`, password: '', demo: true, emailVerified: false }; await db.insert(users).values(user); await seedBusiness(id); await setSession(id, 1); return user; }
export async function ownerBusiness() { const user = await getUser(); if (!user) return null; const [business] = await db.select().from(businesses).where(eq(businesses.ownerId, user.id)); return business ?? null; }
export async function activity(businessId: string, text: string, type = 'product') { await db.insert(activities).values({ id: uid(), businessId, text, type }); }
export async function createToken(userId: string, type: 'verify' | 'reset', ttlMs: number) { await db.delete(verificationTokens).where(and(eq(verificationTokens.userId, userId), eq(verificationTokens.type, type))); const token = randomBytes(32).toString('hex'); await db.insert(verificationTokens).values({ token: hashToken(token), userId, type, expires: new Date(Date.now() + ttlMs) }); return token; }
export async function consumeToken(token: string, type: 'verify' | 'reset') { const [row] = await db.select().from(verificationTokens).where(and(eq(verificationTokens.token, hashToken(token)), eq(verificationTokens.type, type), gt(verificationTokens.expires, new Date()))); if (!row) return null; await db.delete(verificationTokens).where(eq(verificationTokens.token, hashToken(token))); return row; }
export async function revokeSessions(userId: string) { await db.delete(sessions).where(eq(sessions.userId, userId)); }
