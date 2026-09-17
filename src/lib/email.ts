// Sends transactional email via Resend (https://resend.com). Set RESEND_API_KEY
// and EMAIL_FROM in your environment to enable real delivery. Without an API
// key, emails are logged to the server console instead so verification and
// password reset can still be tested locally.

async function send(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Platera <onboarding@resend.dev>';
  if (!apiKey) {
    console.log(`\n[email] RESEND_API_KEY is not set — logging email instead of sending it.\n[email] To: ${to}\n[email] Subject: ${subject}\n[email] ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`);
    return { delivered: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, subject, html }) });
    if (!res.ok) { console.error('[email] Send failed', res.status, await res.text().catch(() => '')); return { delivered: false }; }
    return { delivered: true };
  } catch (e) { console.error('[email] Send error', e); return { delivered: false }; }
}

function shell(title: string, body: string, ctaUrl: string, ctaLabel: string) {
  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1f2a20"><h2 style="margin:0 0 12px">${title}</h2><p style="line-height:1.6">${body}</p><p style="margin:28px 0"><a href="${ctaUrl}" style="background:#294c3b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${ctaLabel}</a></p><p style="font-size:13px;color:#6b7a6d">If the button doesn't work, copy and paste this link:<br/>${ctaUrl}</p></div>`;
}

export async function sendVerificationEmail(to: string, name: string, verifyUrl: string) {
  const html = shell('Verify your email', `Hi ${name || 'there'}, please confirm your email to finish setting up your Platera restaurant workspace. This link expires in 24 hours.`, verifyUrl, 'Verify email');
  return send(to, 'Verify your email for Platera', html);
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string) {
  const html = shell('Reset your password', `Hi ${name || 'there'}, we received a request to reset your Platera password. This link expires in 1 hour. If you didn't request this, you can safely ignore this email.`, resetUrl, 'Reset password');
  return send(to, 'Reset your Platera password', html);
}
