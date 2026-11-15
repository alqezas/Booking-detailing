/**
 * Nova Poshta API 2.0 (https://developers.novaposhta.ua/): settlement search,
 * pickup points and server-side verification of the buyer's choice.
 *
 * Settlement vs city: searchSettlements returns the settlement Ref (Ref) and
 * the delivery city Ref (DeliveryCity). Pickup points are listed by the
 * delivery city (CityRef); a point also carries its SettlementRef. We store
 * both and check both.
 */
import {ApiError, withRetry} from './http.ts';
import {npTypesFor, type DeliveryMethod, type NpSettlement, type NpWarehouse} from './contracts.ts';

export type NpConfig = {apiUrl: string; apiKey: string; timeoutMs?: number};

type NpResponse<T> = {success: boolean; data: T[]; errors?: string[]; info?: {totalCount?: number} | unknown[]};

class NpUnavailable extends Error {}

const cache = new Map<string, {at: number; value: unknown}>();
const TTL = 10 * 60_000;
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value as T);
  return load().then(v => {
    if (cache.size > 2000) cache.clear();
    cache.set(key, {at: Date.now(), value: v});
    return v;
  });
}
export const clearNpCache = () => cache.clear();

async function call<T>(cfg: NpConfig, model: string, method: string, props: Record<string, string>): Promise<NpResponse<T>> {
  return withRetry(
    async () => {
      let res: Response;
      try {
        res = await fetch(cfg.apiUrl, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({apiKey: cfg.apiKey, modelName: model, calledMethod: method, methodProperties: props}),
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
        });
      } catch {
        throw new NpUnavailable('network');
      }
      if (res.status >= 500) throw new NpUnavailable(`http ${res.status}`);
      const body = (await res.json().catch(() => null)) as NpResponse<T> | null;
      if (!body || typeof body !== 'object') throw new NpUnavailable('bad body');
      if (!body.success) throw new NpUnavailable(`api: ${(body.errors ?? []).join('; ').slice(0, 200)}`);
      return body;
    },
    {tries: 2, baseMs: 300, retryable: e => e instanceof NpUnavailable},
  ).catch(e => {
    if (e instanceof NpUnavailable) {
      console.error('nova poshta unavailable:', e.message);
      throw new ApiError('NP_UNAVAILABLE', 503);
    }
    throw e;
  });
}

type RawSettlement = {
  Present: string;
  Ref: string;
  DeliveryCity: string;
  MainDescription: string;
  Area: string;
  Region: string;
  SettlementTypeCode: string;
  Warehouses: number | string;
};

export async function searchSettlements(cfg: NpConfig, query: string, page = 1): Promise<{items: NpSettlement[]; total: number}> {
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return {items: [], total: 0};
  return cached(`s:${q.toLowerCase()}:${page}`, async () => {
    const res = await call<{TotalCount: number; Addresses: RawSettlement[]}>(cfg, 'AddressGeneral', 'searchSettlements', {
      CityName: q,
      Limit: '20',
      Page: String(page),
    });
    const block = res.data[0];
    const items = (block?.Addresses ?? [])
      // Only settlements that have a delivery city (pickup points live there).
      .filter(a => a.DeliveryCity && Number(a.Warehouses) > 0)
      .map(a => ({
        settlement_ref: a.Ref,
        city_ref: a.DeliveryCity,
        name: a.MainDescription,
        area: a.Area,
        region: a.Region,
        type: a.SettlementTypeCode,
        label: a.Present,
      }));
    return {items, total: Number(block?.TotalCount ?? items.length)};
  });
}

type RawWarehouse = {
  Ref: string;
  Number: string;
  Description: string;
  ShortAddress: string;
  TypeOfWarehouse: string;
  CategoryOfWarehouse: string;
  CityRef: string;
  SettlementRef: string;
  WarehouseStatus?: string;
};
const toWarehouse = (w: RawWarehouse): NpWarehouse => ({
  ref: w.Ref,
  number: w.Number,
  name: w.Description,
  short_address: w.ShortAddress,
  type_ref: w.TypeOfWarehouse,
  category: w.CategoryOfWarehouse,
  city_ref: w.CityRef,
  settlement_ref: w.SettlementRef,
});

/**
 * Pickup points of one type family in a delivery city. The API filters by one
 * TypeOfWarehouseRef at a time, so the cursor walks type by type, page by page:
 * search is never limited to the first page.
 */
export async function searchWarehouses(
  cfg: NpConfig,
  input: {cityRef: string; method: DeliveryMethod; query: string; cursor?: string | null},
): Promise<{items: NpWarehouse[]; next: string | null}> {
  const types = npTypesFor(input.method);
  const q = input.query.trim().slice(0, 60);
  let [typeIdx, page] = (input.cursor ?? '0:1').split(':').map(Number) as [number, number];
  if (!Number.isInteger(typeIdx) || !Number.isInteger(page) || typeIdx < 0 || page < 1 || typeIdx >= types.length || page > 200) {
    throw new ApiError('BAD_REQUEST', 400);
  }
  const limit = 30;
  const items: NpWarehouse[] = [];
  while (typeIdx < types.length && items.length < limit) {
    const typeRef = types[typeIdx]!;
    const res = await cached(`w:${input.cityRef}:${typeRef}:${q.toLowerCase()}:${page}`, () =>
      call<RawWarehouse>(cfg, 'AddressGeneral', 'getWarehouses', {
        CityRef: input.cityRef,
        TypeOfWarehouseRef: typeRef,
        FindByString: q,
        Limit: String(limit),
        Page: String(page),
      }),
    );
    const got = res.data.filter(w => w.TypeOfWarehouse === typeRef && w.CityRef === input.cityRef && w.WarehouseStatus !== 'NotWorking');
    items.push(...got.map(toWarehouse));
    if (res.data.length < limit) {
      typeIdx += 1;
      page = 1;
    } else {
      page += 1;
      break; // a full page: let the buyer ask for more
    }
  }
  return {items, next: typeIdx < types.length ? `${typeIdx}:${page}` : null};
}

/** Fetch one point by Ref and check it belongs to the chosen city/settlement and method. */
export async function verifyWarehouse(
  cfg: NpConfig,
  d: {method: DeliveryMethod; settlement_ref: string; city_ref: string; warehouse_ref: string},
): Promise<{warehouse: NpWarehouse; settlementName: string; area: string | null}> {
  const res = await call<RawWarehouse & {CityDescription: string; SettlementDescription: string; SettlementAreaDescription: string}>(
    cfg,
    'AddressGeneral',
    'getWarehouses',
    {Ref: d.warehouse_ref},
  );
  const w = res.data.find(x => x.Ref === d.warehouse_ref);
  if (!w) throw new ApiError('NP_POINT_INVALID', 422, {field: 'warehouse'});
  const typeOk = npTypesFor(d.method).includes(w.TypeOfWarehouse);
  const cityOk = w.CityRef === d.city_ref;
  // SettlementRef is present for current points; when it is, it must match too.
  const settlementOk = !w.SettlementRef || w.SettlementRef === d.settlement_ref;
  if (!typeOk || !cityOk || !settlementOk || w.WarehouseStatus === 'NotWorking') {
    throw new ApiError('NP_POINT_INVALID', 422, {field: 'warehouse', typeOk, cityOk, settlementOk});
  }
  return {
    warehouse: toWarehouse(w),
    settlementName: w.SettlementDescription || w.CityDescription,
    area: w.SettlementAreaDescription || null,
  };
}
