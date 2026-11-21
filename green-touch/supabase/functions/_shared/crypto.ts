/** Web Crypto helpers (identical in Deno and Node ≥ 20). */

const enc = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf as BufferSource));
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Postgres bytea literal for PostgREST (`\x…`). */
export const byteaHex = (bytes: Uint8Array) => `\\x${toHex(bytes)}`;

/** JSON with sorted keys: stable input for request fingerprints. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter(k => o[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** DER-encoded ECDSA signature → IEEE P1363 (r‖s), the form Web Crypto verifies. */
export function derToP1363(der: Uint8Array, size = 32): Uint8Array {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error('bad DER');
  const len = der[i++]!;
  if (len & 0x80) i += len & 0x7f;
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error('bad DER int');
    const l = der[i++]!;
    let v = der.slice(i, i + l);
    i += l;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    if (v.length > size) throw new Error('bad DER int size');
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const out = new Uint8Array(size * 2);
  out.set(r, 0);
  out.set(s, size);
  return out;
}

/** PEM (or base64-encoded PEM, as mono returns it) → SPKI DER bytes. */
export function pemToDer(pemOrB64: string): Uint8Array {
  let pem = pemOrB64.trim();
  if (!pem.includes('-----BEGIN')) pem = new TextDecoder().decode(fromBase64(pem));
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  return fromBase64(body);
}

/** Verify mono's X-Sign (base64 DER ECDSA P-256 / SHA-256) over the exact raw body bytes. */
export async function verifyEcdsaSignature(pubKey: string, rawBody: Uint8Array, signatureB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', pemToDer(pubKey) as BufferSource, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    const sig = fromBase64(signatureB64.trim());
    const raw = sig.length === 64 ? sig : derToP1363(sig);
    return await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, raw as BufferSource, rawBody as BufferSource);
  } catch {
    return false;
  }
}
