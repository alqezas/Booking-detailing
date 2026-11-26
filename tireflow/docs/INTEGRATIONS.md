# External integrations

Status is shown per business in **Notifications → Channels**:
`test` (test adapter — messages are recorded, **nothing is delivered**), `Connected`, `Not connected`.

Secrets are never stored in tables or in Vercel. They are **Supabase Edge Function secrets**:

```bash
pnpm exec supabase secrets set KEY=value
```

Then set the channel's provider for the business (SQL editor or a future settings UI):

```sql
update public.notification_channels set provider = 'twilio', is_enabled = true
where business_id = '<id>' and channel = 'sms';
```

| Channel | Provider value | Secrets | Notes |
| --- | --- | --- | --- |
| Email | `resend` | `RESEND_API_KEY`, `EMAIL_FROM` | verify the sending domain in Resend |
| SMS | `twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | an alphanumeric sender may need registration per country |
| WhatsApp | `whatsapp_cloud` | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | **official WhatsApp Business Cloud API only**; business-initiated messages require approved templates. No automation of personal accounts. |
| Telegram | `telegram_bot` | `TELEGRAM_BOT_TOKEN` | the recipient must have started the bot; store its chat id as the recipient |
| Web Push | `web_push` | VAPID keys (planned) | service worker already handles `push` events; sending is not implemented yet |
| In-app | — | — | `inbox_notifications` (staff), RLS-filtered |

If a provider is selected but its secret is missing, jobs fail with
`provider … is not configured` and go to the retry/dead-letter flow — they are never
reported as delivered.

## Adding a provider

Implement an `Adapter` in `supabase/functions/notifications-worker/index.ts`
(`(job) => Promise<{ ok, provider, messageId?, detail?, retryable? }>`), map it in
`adapterFor()`, add the provider value to the `notification_channels.provider` check.

## Fiscal / accounting

The finance module is management accounting only and is labelled as such. Country
fiscalisation (e.g. Polish fiscal printers, Ukrainian PRRO, Czech EET if reintroduced)
and accounting exports must be separate integrations.

## AI assistant (not implemented yet)

Planned design: module `ai_assistant` (off by default). A server route calls the LLM
through the Vercel AI Gateway with **tools that wrap existing RPCs** (`analytics_summary`,
`dashboard_stats`, `search_customers` with masked PII), executed with the user's session
so RLS and permissions apply. Tools are read-only; any write (prices, messages,
payments) only produces a draft that the user confirms in the UI.
