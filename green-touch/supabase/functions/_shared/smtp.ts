/**
 * SMTP transport for order emails (Deno Edge Function only).
 * Gmail: SMTP_USER = the shop's Gmail address, SMTP_PASS = a 16-character
 * app password (Google account → Security → 2-Step Verification → App passwords).
 * Port 465 (TLS): Supabase Edge Functions block outgoing ports 25 and 587.
 */
import nodemailer from 'nodemailer';
import type {Mailer} from './email.ts';

type Env = (name: string) => string | undefined;

export function smtpMailerFromEnv(get: Env): Mailer | null {
  const user = get('SMTP_USER');
  const pass = get('SMTP_PASS');
  if (!user || !pass) return null;
  const transport = nodemailer.createTransport({
    host: get('SMTP_HOST') || 'smtp.gmail.com',
    port: Number(get('SMTP_PORT') || 465),
    secure: true,
    auth: {user, pass: pass.replace(/\s+/g, '')}, // Google shows the app password in groups of 4
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  const from = {name: get('MAIL_FROM_NAME') || 'Green Touch', address: get('MAIL_FROM') || user};
  const replyTo = get('MAIL_REPLY_TO') || undefined;
  return {
    async send(m) {
      await transport.sendMail({from, to: m.to, replyTo, subject: m.subject, text: m.text, html: m.html});
    },
  };
}
