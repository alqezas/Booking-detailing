/**
 * Controlled test adapter for LiqPay (CI only — not the real LiqPay).
 * Checks incoming signatures and signs callbacks with the same formula as
 * LiqPay: base64(sha3-256(private_key + data + private_key)), form fields data+signature.
 */
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {decodeData, encodeData, sign, type LiqPayConfig} from '../../supabase/functions/_shared/liqpay.ts';

export type FakePayment = {
  order_id: string;
  amount: number;
  currency: string;
  description: string;
  status: string;
  payment_id: number;
  server_url: string;
  result_url: string;
  expired_date: string;
  sandbox: boolean;
  create_date: number;
  end_date?: number;
};

export type FakeLiqPay = {
  url: string;
  cfg: LiqPayConfig;
  payments: Map<string, FakePayment>;
  /** what the browser does: POST data+signature to /api/3/checkout */
  openCheckout(c: {url: string; data: string; signature: string}): Promise<number>;
  setStatus(orderId: string, status: string, opts?: {callback?: boolean; amount?: number; currency?: string}): Promise<{data: string; signature: string; status: number | null}>;
  callbackBody(p: FakePayment, override?: Partial<FakePayment>): {data: string; signature: string};
  close(): Promise<void>;
};

let nextPaymentId = 100000;

export async function startFakeLiqPay(port = 0, keys = {publicKey: 'sandbox_test_public', privateKey: 'sandbox_test_private'}): Promise<FakeLiqPay> {
  const cfg: LiqPayConfig = {...keys, apiUrl: '', algo: 'sha3-256', sandbox: true};
  const payments = new Map<string, FakePayment>();
  const read = (req: IncomingMessage) =>
    new Promise<string>(r => {
      let s = '';
      req.on('data', c => (s += c));
      req.on('end', () => r(s));
    });
  const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, {'content-type': type});
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const statusObj = (p: FakePayment, o: Partial<FakePayment> = {}) => {
    const v = {...p, ...o};
    return {
      action: 'pay',
      public_key: cfg.publicKey,
      status: v.status,
      order_id: v.order_id,
      amount: v.amount,
      currency: v.currency,
      payment_id: v.payment_id,
      liqpay_order_id: `LP${v.payment_id}`,
      create_date: v.create_date,
      ...(v.end_date ? {end_date: v.end_date} : {}),
      ...(v.status === 'failure' ? {err_code: 'limit', err_description: 'Тестова відмова'} : {}),
    };
  };
  const callbackBody = (p: FakePayment, o: Partial<FakePayment> = {}) => {
    const data = encodeData(statusObj(p, o));
    return {data, signature: sign(cfg, data)};
  };

  async function setStatus(orderId: string, status: string, opts: {callback?: boolean; amount?: number; currency?: string} = {}) {
    const p = payments.get(orderId);
    if (!p) throw new Error('no payment ' + orderId);
    p.status = status;
    p.end_date = Date.now();
    const body = callbackBody(p, {amount: opts.amount ?? p.amount, currency: opts.currency ?? p.currency});
    let code: number | null = null;
    if (opts.callback !== false && p.server_url) {
      const r = await fetch(p.server_url, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body)}).catch(() => null);
      code = r?.status ?? null;
    }
    return {...body, status: code};
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST' && (url.pathname === '/api/3/checkout' || url.pathname === '/api/request')) {
      const form = new URLSearchParams(await read(req));
      const data = form.get('data') ?? '';
      if (sign(cfg, data) !== form.get('signature')) return send(res, 200, {result: 'error', err_code: 'invalid_signature'});
      const p = decodeData(data) as Record<string, string | number>;
      if (p.public_key !== cfg.publicKey) return send(res, 200, {result: 'error', err_code: 'public_key_not_found'});
      if (url.pathname === '/api/request') {
        if (p.action !== 'status') return send(res, 200, {result: 'error', err_code: 'unsupported'});
        const pay = payments.get(String(p.order_id));
        if (!pay || pay.status === 'created') return send(res, 200, {result: 'error', err_code: 'payment_not_found'});
        return send(res, 200, {result: 'ok', ...statusObj(pay)});
      }
      // checkout: same order_id cannot be paid twice
      const existing = payments.get(String(p.order_id));
      if (existing && existing.status === 'success') return send(res, 200, 'order already paid', 'text/plain');
      const pay: FakePayment = existing ?? {
        order_id: String(p.order_id),
        amount: Number(p.amount),
        currency: String(p.currency),
        description: String(p.description),
        status: 'created',
        payment_id: nextPaymentId++,
        server_url: String(p.server_url ?? ''),
        result_url: String(p.result_url ?? ''),
        expired_date: String(p.expired_date ?? ''),
        sandbox: p.sandbox === 1 || p.sandbox === '1',
        create_date: Date.now(),
      };
      payments.set(pay.order_id, pay);
      res.writeHead(303, {location: `/pay/${encodeURIComponent(pay.order_id)}`});
      return res.end();
    }
    const m = url.pathname.match(/^\/pay\/(.+)$/);
    if (m) {
      const pay = payments.get(decodeURIComponent(m[1]!));
      if (!pay) return send(res, 404, 'not found', 'text/plain');
      if (req.method === 'POST') {
        const action = new URLSearchParams(await read(req)).get('action');
        await setStatus(pay.order_id, 'processing');
        await setStatus(pay.order_id, action === 'fail' ? 'failure' : pay.sandbox ? 'sandbox' : 'success');
        res.writeHead(303, {location: pay.result_url});
        return res.end();
      }
      return send(
        res,
        200,
        `<!doctype html><meta charset="utf-8"><title>Тестова оплата</title><h1>Тестовий адаптер LiqPay (не справжній LiqPay)</h1>
<p>${pay.description}: ${pay.amount.toFixed(2)} ${pay.currency} · статус: ${pay.status}</p>
<form method="post"><button name="action" value="pay">Оплатити (тест)</button> <button name="action" value="fail">Відмова (тест)</button></form>`,
        'text/html; charset=utf-8',
      );
    }
    send(res, 404, {result: 'error', err_code: 'not_found'});
  });

  await new Promise<void>(r => server.listen(port, '0.0.0.0', r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`;
  cfg.apiUrl = base;
  return {
    url: base,
    cfg,
    payments,
    openCheckout: async c => (await fetch(c.url, {method: 'POST', body: new URLSearchParams({data: c.data, signature: c.signature}), redirect: 'manual'})).status,
    setStatus,
    callbackBody,
    close: () => new Promise(r => server.close(() => r())),
  };
}
