import VerifyEmailForm from '@/components/verify-email-form';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <VerifyEmailForm token={token || ''} />;
}
