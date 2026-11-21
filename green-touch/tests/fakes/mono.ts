/**
 * Controlled test adapter for plata by mono (CI only — not the real bank).
 * Implements the documented endpoints and signs webhooks exactly like the
 * provider: X-Sign = base64(DER ECDSA P-256/SHA-256 over the raw body), public
 * key served base64-encoded PEM from /api/merchant/pubkey.
 */
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';

export type FakeInvoice = {
  invoiceId: string;
  amount: number;
  ccy: number;
  status: 'created' | 'processing' | 'hold' | 'success' | 'failure' | 'reversed' | 'expired';
  reference: string;
  createdDate: string;
  modifiedDate: string;
  webHookUrl: string;
  redirectUrl: string;
  validity: number;
  removed: boolean;
};

export type FakeMono = {
  url: string;
  token: string;
  invoices: Map<string, FakeInvoice>;
  /** next N create calls fail with HTTP 500 */
  failCreates(n: number): void;
  /** delay the next create responses (simulates a slow provider) */
  setCreateDelay(ms: number): void;
  setStatus(invoiceId: string, status: FakeInvoice['status'], opts?: {webhook?: boolean}): Promise<{body: string; sign: string; status: number | null}>;
  signBody(body: string): string;
  /** signs with a different key (for invalid-signature tests) */
  signWithOtherKey(body: string): string;
  statusBody(inv: FakeInvoice, override?: Partial<FakeInvoice>): string;
  close(): Promise<void>;
};

export async function startFakeMono(port = 0, token = 'test-mono-token'): Promise<FakeMono> {
  const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const other = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const pem = publicKey.export({type: 'spki', format: 'pem'}).toString();
  const invoices = new Map<string, FakeInvoice>();
  let failCreates = 0;
  let createDelay = 0;
  let base = '';

  const signBody = (body: string) => sign('sha256', Buffer.from(body), privateKey).toString('base64');
  const signWithOtherKey = (body: string) => sign('sha256', Buffer.from(body), other.privateKey).toString('base64');
  const statusBody = (inv: FakeInvoice, o: Partial<FakeInvoice> = {}) => {
    const v = {...inv, ...o};
    return JSON.stringify({
      invoiceId: v.invoiceId,
      status: v.status,
      amount: v.amount,
      ccy: v.ccy,
      finalAmount: v.status === 'success' ? v.amount : 0,
      createdDate: v.createdDate,
      modifiedDate: v.modifiedDate,
      reference: v.reference,
      ...(v.status === 'failure' ? {failureReason: 'Тестова відмова'} : {}),
    });
  };
  const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, {'content-type': type});
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const read = (req: IncomingMessage) =>
    new Promise<string>(resolve => {
      let s = '';
      req.on('data', c => (s += c));
      req.on('end', () => resolve(s));
    });

  async function setStatus(id: string, status: FakeInvoice['status'], opts: {webhook?: boolean} = {}) {
    const inv = invoices.get(id);
    if (!inv) throw new Error('no invoice ' + id);
    inv.status = status;
    inv.modifiedDate = new Date(Math.max(Date.now(), Date.parse(inv.modifiedDate) + 1000)).toISOString();
    const body = statusBody(inv);
    const sig = signBody(body);
    let code: number | null = null;
    if (opts.webhook !== false && status !== 'expired') {
      const r = await fetch(inv.webHookUrl, {method: 'POST', headers: {'content-type': 'application/json', 'x-sign': sig}, body}).catch(() => null);
      code = r?.status ?? null;
    }
    return {body, sign: sig, status: code};
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const authed = req.headers['x-token'] === token;
    if (url.pathname === '/api/merchant/pubkey') {
      if (!authed) return send(res, 403, {errCode: 'FORBIDDEN'});
      return send(res, 200, {key: Buffer.from(pem).toString('base64')});
    }
    if (url.pathname === '/api/merchant/invoice/create' && req.method === 'POST') {
      if (!authed) return send(res, 403, {errCode: 'FORBIDDEN'});
      const b = JSON.parse(await read(req));
      if (createDelay) await new Promise(r => setTimeout(r, createDelay));
      if (failCreates > 0) {
        failCreates--;
        return send(res, 500, {errCode: 'INTERNAL_ERROR'});
      }
      if (!Number.isInteger(b.amount) || b.ccy !== 980 || !b.webHookUrl) return send(res, 400, {errCode: 'BAD_REQUEST'});
      const now = new Date().toISOString();
      const inv: FakeInvoice = {
        invoiceId: 'inv_' + randomUUID().replace(/-/g, '').slice(0, 20),
        amount: b.amount,
        ccy: b.ccy,
        status: 'created',
        reference: b.merchantPaymInfo?.reference ?? '',
        createdDate: now,
        modifiedDate: now,
        webHookUrl: b.webHookUrl,
        redirectUrl: b.redirectUrl,
        validity: b.validity,
        removed: false,
      };
      invoices.set(inv.invoiceId, inv);
      return send(res, 200, {invoiceId: inv.invoiceId, pageUrl: `${base}/pay/${inv.invoiceId}`});
    }
    if (url.pathname === '/api/merchant/invoice/status') {
      if (!authed) return send(res, 403, {errCode: 'FORBIDDEN'});
      const inv = invoices.get(url.searchParams.get('invoiceId') ?? '');
      if (!inv) return send(res, 404, {errCode: 'NOT_FOUND'});
      // Validity passed without payment → expired (mono sends no webhook for this).
      if (inv.status === 'created' && Date.parse(inv.createdDate) + inv.validity * 1000 < Date.now()) {
        inv.status = 'expired';
        inv.modifiedDate = new Date().toISOString();
      }
      return send(res, 200, statusBody(inv));
    }
    if (url.pathname === '/api/merchant/invoice/remove' && req.method === 'POST') {
      if (!authed) return send(res, 403, {errCode: 'FORBIDDEN'});
      const inv = invoices.get(JSON.parse(await read(req)).invoiceId);
      if (!inv) return send(res, 404, {errCode: 'NOT_FOUND'});
      if (inv.status !== 'created') return send(res, 400, {errCode: 'INVOICE_NOT_REMOVABLE'});
      inv.removed = true;
      inv.status = 'expired';
      inv.modifiedDate = new Date().toISOString();
      return send(res, 200, {});
    }
    // Hosted payment page of the test adapter (Playwright clicks these buttons).
    const pay = url.pathname.match(/^\/pay\/([\w]+)$/);
    if (pay) {
      const inv = invoices.get(pay[1]!);
      if (!inv) return send(res, 404, 'not found', 'text/plain');
      if (req.method === 'POST') {
        const action = new URLSearchParams(await read(req)).get('action');
        await setStatus(inv.invoiceId, 'processing');
        await setStatus(inv.invoiceId, action === 'fail' ? 'failure' : 'success');
        res.writeHead(303, {location: inv.redirectUrl});
        return res.end();
      }
      return send(
        res,
        200,
        `<!doctype html><meta charset="utf-8"><title>Тестова оплата</title><h1>Тестовий адаптер mono (не банк)</h1>
<p>Сума: ${(inv.amount / 100).toFixed(2)} UAH · ${inv.reference} · статус: ${inv.status}</p>
<form method="post"><button name="action" value="pay">Оплатити (тест)</button> <button name="action" value="fail">Відмова (тест)</button></form>`,
        'text/html; charset=utf-8',
      );
    }
    send(res, 404, {errCode: 'NOT_FOUND'});
  });

  await new Promise<void>(r => server.listen(port, '0.0.0.0', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`;
  return {
    url: base,
    token,
    invoices,
    failCreates: n => void (failCreates = n),
    setCreateDelay: ms => void (createDelay = ms),
    setStatus,
    signBody,
    signWithOtherKey,
    statusBody,
    close: () => new Promise(r => server.close(() => r())),
  };
}
