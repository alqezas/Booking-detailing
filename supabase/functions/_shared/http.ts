/** CORS + JSON helpers for edge functions. */
const ALLOWED_ORIGINS = (globalThis as {Deno?: {env: {get(k: string): string | undefined}}}).Deno?.env.get('ALLOWED_ORIGINS')?.split(',').map(s => s.trim()).filter(Boolean) ?? [];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin) ? origin || '*' : ALLOWED_ORIGINS[0]!;
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}

export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...corsHeaders(req), 'content-type': 'application/json; charset=utf-8'}});

export const fail = (req: Request, status: number, code: string, message: string) => json(req, {error: code, message}, status);

export function clientIp(req: Request): string {
  return (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();
}
