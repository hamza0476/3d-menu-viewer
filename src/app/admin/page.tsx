import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import AdminPanel from '@/components/admin-panel';

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) redirect('/');
  return <AdminPanel adminName={admin.name} />;
}
