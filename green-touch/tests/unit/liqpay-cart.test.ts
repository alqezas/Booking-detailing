import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {checkoutPayload, decodeData, normalizeStatus, sign, verify, type LiqPayConfig} from '../../supabase/functions/_shared/liqpay.ts';
import {cartReducer, parseCart, type CartState} from '../../src/lib/cart.ts';

const cfg: LiqPayConfig = {publicKey: 'pub', privateKey: 'priv', apiUrl: 'https://www.liqpay.ua', algo: 'sha3-256', sandbox: false};

describe('LiqPay signature', () => {
  it('is base64(sha3-256(private + data + private)), identical to Node crypto', () => {
    const data = Buffer.from('{"a":1}').toString('base64');
    const expected = createHash('sha3-256').update('priv' + data + 'priv').digest('base64');
    expect(sign(cfg, data)).toBe(expected);
    expect(verify(cfg, data, expected)).toBe(true);
    expect(verify(cfg, data + 'x', expected)).toBe(false);
    expect(verify({...cfg, privateKey: 'other'}, data, expected)).toBe(false);
  });
  it('supports legacy sha1 accounts', () => {
    const data = 'ZGF0YQ==';
    expect(sign({...cfg, algo: 'sha1'}, data)).toBe(createHash('sha1').update('priv' + data + 'priv').digest('base64'));
  });
  it('builds a checkout payload with the server amount and no private key', () => {
    const p = checkoutPayload(cfg, {amountKop: 176000, orderId: 'GT-1-abc', description: 'x', resultUrl: 'https://s/r', serverUrl: 'https://s/cb', expiresAt: new Date('2026-11-16T10:00:00Z')});
    const d = decodeData(p.data) as Record<string, unknown>;
    expect(d).toMatchObject({version: 3, action: 'pay', amount: '1760.00', currency: 'UAH', order_id: 'GT-1-abc', expired_date: '2026-11-16 10:00:00'});
    expect(d).not.toHaveProperty('sandbox');
    expect(p.data + p.signature).not.toContain('priv');
  });
  it('maps statuses; «sandbox» counts as paid only in sandbox mode', () => {
    expect(normalizeStatus(cfg, 'success')).toBe('success');
    expect(normalizeStatus(cfg, 'sandbox')).toBeNull();
    expect(normalizeStatus({...cfg, sandbox: true}, 'sandbox')).toBe('success');
    expect(normalizeStatus(cfg, 'error')).toBe('failure');
    expect(normalizeStatus(cfg, '3ds_verify')).toBe('processing');
    expect(normalizeStatus(cfg, 'reversed')).toBe('reversed');
  });
});

describe('cart', () => {
  const item = {id: 'a', kind: 'kit' as const, slug: 'k', name: 'Набір', volume: null, price_kop: 136000, base_kop: 160000, image: null};
  const empty: CartState = {lines: [], updated_at: 0};
  it('adds, merges, clamps and removes; a kit is one line', () => {
    let s = cartReducer(empty, {type: 'add', item, qty: 1});
    s = cartReducer(s, {type: 'add', item, qty: 60});
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]!.qty).toBe(50);
    s = cartReducer(s, {type: 'set', id: 'a', qty: 0});
    expect(s.lines).toHaveLength(0);
  });
  it('survives a corrupted localStorage value', () => {
    expect(parseCart('not json').lines).toEqual([]);
    expect(parseCart(JSON.stringify({lines: [{id: 'a', qty: 999}, {id: 'b', qty: -1}]})).lines).toEqual([{id: 'a', qty: 50}]);
  });
});
