import { getUser } from '@/lib/auth';

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin() {
  const user = await getUser();
  if (!user || user.demo) return null;
  const allowed = adminEmails();
  if (!allowed.length || !allowed.includes(user.email.toLowerCase())) return null;
  return user;
}
