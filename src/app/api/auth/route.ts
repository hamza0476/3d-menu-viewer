import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users, sessions } from '@/db/schema';
import { getUser, uid, hashPassword, verifyPassword, setSession, seedBusiness, createToken, consumeToken, revokeSessions } from '@/lib/auth';
import { sendVerificationEmail, sendPasswordResetEmail } from '@/lib/email';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';

export async function POST(req: Request) {
  const b = await req.json();
  const ip = clientIp(req);
  const origin = new URL(req.url).origin;

  if (b.action === 'logout') {
    const cookie = (await cookies()).get('platera_session');
    if (cookie) await db.delete(sessions).where(eq(sessions.token, cookie.value));
    (await cookies()).delete('platera_session');
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'resend-verification') {
    const user = await getUser();
    if (!user || user.demo) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
    if (user.emailVerified) return NextResponse.json({ ok: true });
    if (!rateLimit(`resend:${user.id}`, 3, 3600000).allowed) return NextResponse.json({ error: 'Please wait a bit before requesting another verification email.' }, { status: 429 });
    const token = await createToken(user.id, 'verify', 24 * 3600000);
    await sendVerificationEmail(user.email, user.name, `${origin}/api/verify?token=${token}`);
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'forgot') {
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    const ipOk = rateLimit(`forgot-ip:${ip}`, 8, 3600000).allowed;
    const emailOk = rateLimit(`forgot-email:${email}`, 4, 3600000).allowed;
    if (!ipOk || !emailOk) return NextResponse.json({ error: TOO_MANY }, { status: 429 });
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing && !existing.demo) {
      const token = await createToken(existing.id, 'reset', 3600000);
      await sendPasswordResetEmail(existing.email, existing.name, `${origin}/reset-password?token=${token}`);
    }
    // Always respond the same way whether or not the account exists, so this endpoint can't be used to discover registered emails.
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'reset') {
    const token = String(b.token || '');
    const password = String(b.password || '');
    if (password.length < 8 || password.length > 128) return NextResponse.json({ error: 'Use a password of 8–128 characters.' }, { status: 400 });
    if (!rateLimit(`reset-ip:${ip}`, 10, 3600000).allowed) return NextResponse.json({ error: TOO_MANY }, { status: 429 });
    const row = await consumeToken(token, 'reset');
    if (!row) return NextResponse.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, { status: 400 });
    await db.update(users).set({ password: hashPassword(password) }).where(eq(users.id, row.userId));
    await revokeSessions(row.userId);
    await setSession(row.userId);
    return NextResponse.json({ ok: true });
  }

  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!EMAIL_RE.test(email) || password.length < 8 || password.length > 128) return NextResponse.json({ error: 'Use a valid email and a password of 8–128 characters.' }, { status: 400 });

  if (b.action === 'login') {
    const ipOk = rateLimit(`login-ip:${ip}`, 30, 900000).allowed;
    const emailOk = rateLimit(`login-email:${email}`, 8, 900000).allowed;
    if (!ipOk || !emailOk) return NextResponse.json({ error: TOO_MANY }, { status: 429 });
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (!existing || !verifyPassword(password, existing.password)) return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
    await setSession(existing.id);
    return NextResponse.json({ ok: true });
  }

  if (!rateLimit(`register-ip:${ip}`, 6, 3600000).allowed) return NextResponse.json({ error: 'Too many accounts created from this connection. Please try again later.' }, { status: 429 });
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return NextResponse.json({ error: 'This email already has an account. Please sign in.' }, { status: 409 });
  const name = String(b.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
  const current = await getUser();
  let userId: string;
  if (current?.demo) {
    userId = current.id;
    await db.update(users).set({ name, email, password: hashPassword(password), demo: false, emailVerified: false }).where(eq(users.id, current.id));
  } else {
    userId = uid();
    await db.insert(users).values({ id: userId, name, email, password: hashPassword(password), demo: false });
    await seedBusiness(userId, String(b.businessName || 'My restaurant'));
    await setSession(userId);
  }
  const token = await createToken(userId, 'verify', 24 * 3600000);
  await sendVerificationEmail(email, name, `${origin}/api/verify?token=${token}`);
  return NextResponse.json({ ok: true });
}
