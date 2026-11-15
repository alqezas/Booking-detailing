/**
 * Controlled test adapter for the Nova Poshta API (CI only). Same request and
 * response shapes as api.novaposhta.ua/v2.0/json (AddressGeneral.searchSettlements,
 * getWarehouses with CityRef/TypeOfWarehouseRef/FindByString/Page/Limit/Ref).
 * The data set is small and synthetic; real-API checks live in tests/integration/np-live.ts.
 */
import {createServer, type Server} from 'node:http';

export const NP_FIX = {
  kyiv: {settlement: 'e718a680-4b33-11e4-ab6d-005056801329', city: '8d5a980d-391c-11dd-90d9-001a92567626'},
  bilaKyivska: {settlement: 'e7148607-4b33-11e4-ab6d-005056801329', city: 'db5c88ce-391c-11dd-90d9-001a92567626'},
  bilaZakarpatska: {settlement: '0dafc894-4b3a-11e4-ab6d-005056801329', city: 'fe84e091-64cf-11e9-898c-005056b24375'},
  types: {branch: '841339c7-591a-42e2-8233-7a0a00f0ed6f', cargo: '9a68df70-0267-42a8-bb5c-37f427e36ee4', postomat: 'f9316480-5f2d-425d-bc2c-ac7cd29decf0'},
};

const settlements = [
  {Present: 'м. Київ, Київська обл.', Ref: NP_FIX.kyiv.settlement, DeliveryCity: NP_FIX.kyiv.city, MainDescription: 'Київ', Area: 'Київська', Region: '', SettlementTypeCode: 'м.', Warehouses: 80},
  {Present: 'м. Біла Церква, Білоцерківський р-н, Київська обл.', Ref: NP_FIX.bilaKyivska.settlement, DeliveryCity: NP_FIX.bilaKyivska.city, MainDescription: 'Біла Церква', Area: 'Київська', Region: 'Білоцерківський', SettlementTypeCode: 'м.', Warehouses: 6},
  {Present: 'с. Біла Церква, Рахівський р-н, Закарпатська обл.', Ref: NP_FIX.bilaZakarpatska.settlement, DeliveryCity: NP_FIX.bilaZakarpatska.city, MainDescription: 'Біла Церква', Area: 'Закарпатська', Region: 'Рахівський', SettlementTypeCode: 'с.', Warehouses: 2},
];

const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');
const ref = (n: number) => `${hex(n, 8)}-0000-4000-8000-${hex(n, 12)}`;

type W = {Ref: string; Number: string; Description: string; ShortAddress: string; TypeOfWarehouse: string; CategoryOfWarehouse: string; CityRef: string; SettlementRef: string; CityDescription: string; SettlementDescription: string; SettlementAreaDescription: string; WarehouseStatus: string};
export const warehouses: W[] = [];
// Kyiv: 45 branches (to exercise pagination) and 40 postomats.
for (let i = 1; i <= 45; i++) {
  warehouses.push({Ref: ref(i), Number: String(i), Description: `Відділення №${i}: вул. Тестова, ${i}`, ShortAddress: `Київ, Тестова, ${i}`, TypeOfWarehouse: i % 3 ? NP_FIX.types.branch : NP_FIX.types.cargo, CategoryOfWarehouse: 'Branch', CityRef: NP_FIX.kyiv.city, SettlementRef: NP_FIX.kyiv.settlement, CityDescription: 'Київ', SettlementDescription: 'Київ', SettlementAreaDescription: 'Київська', WarehouseStatus: 'Working'});
}
for (let i = 1; i <= 40; i++) {
  warehouses.push({Ref: ref(1000 + i), Number: String(30000 + i), Description: `Поштомат "Нова Пошта" №${30000 + i}: вул. Хрещатик, ${i}`, ShortAddress: `Київ, Хрещатик, ${i}`, TypeOfWarehouse: NP_FIX.types.postomat, CategoryOfWarehouse: 'Postomat', CityRef: NP_FIX.kyiv.city, SettlementRef: NP_FIX.kyiv.settlement, CityDescription: 'Київ', SettlementDescription: 'Київ', SettlementAreaDescription: 'Київська', WarehouseStatus: 'Working'});
}
for (let i = 1; i <= 3; i++) {
  warehouses.push({Ref: ref(2000 + i), Number: String(i), Description: `Відділення №${i}: вул. Ярослава Мудрого, ${i}`, ShortAddress: `Біла Церква, Ярослава Мудрого, ${i}`, TypeOfWarehouse: NP_FIX.types.branch, CategoryOfWarehouse: 'Branch', CityRef: NP_FIX.bilaKyivska.city, SettlementRef: NP_FIX.bilaKyivska.settlement, CityDescription: 'Біла Церква', SettlementDescription: 'Біла Церква', SettlementAreaDescription: 'Київська', WarehouseStatus: 'Working'});
}
warehouses.push({Ref: ref(3001), Number: '1', Description: 'Пункт №1: вул. Центральна, 1', ShortAddress: 'Біла Церква, Центральна, 1', TypeOfWarehouse: NP_FIX.types.branch, CategoryOfWarehouse: 'Branch', CityRef: NP_FIX.bilaZakarpatska.city, SettlementRef: NP_FIX.bilaZakarpatska.settlement, CityDescription: 'Біла Церква', SettlementDescription: 'Біла Церква', SettlementAreaDescription: 'Закарпатська', WarehouseStatus: 'Working'});

export const NP_POINTS = {
  kyivBranch1: ref(1),
  kyivPostomat1: ref(1001),
  bilaKyivskaBranch1: ref(2001),
  bilaZakarpatskaPoint: ref(3001),
};

export type FakeNp = {url: string; calls: {method: string; props: Record<string, string>}[]; setDown(down: boolean): void; close(): Promise<void>};

export async function startFakeNp(port = 0): Promise<FakeNp> {
  let down = false;
  const calls: FakeNp['calls'] = [];
  const server: Server = createServer((req, res) => {
    let s = '';
    req.on('data', c => (s += c));
    req.on('end', () => {
      if (down) {
        res.writeHead(502);
        return res.end('bad gateway');
      }
      const b = JSON.parse(s || '{}');
      const p: Record<string, string> = b.methodProperties ?? {};
      calls.push({method: b.calledMethod, props: p});
      const ok = (data: unknown[], totalCount?: number) => {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({success: true, data, errors: [], warnings: [], info: totalCount != null ? {totalCount} : [], messageCodes: [], errorCodes: [], warningCodes: [], infoCodes: []}));
      };
      if (b.calledMethod === 'searchSettlements') {
        const q = (p.CityName ?? '').toLowerCase();
        const found = settlements.filter(x => x.MainDescription.toLowerCase().startsWith(q));
        return ok([{TotalCount: found.length, Addresses: found}]);
      }
      if (b.calledMethod === 'getWarehouses') {
        let list = warehouses;
        if (p.Ref) list = list.filter(w => w.Ref === p.Ref);
        if (p.CityRef) list = list.filter(w => w.CityRef === p.CityRef);
        if (p.TypeOfWarehouseRef) list = list.filter(w => w.TypeOfWarehouse === p.TypeOfWarehouseRef);
        if (p.FindByString) list = list.filter(w => w.Description.toLowerCase().includes(p.FindByString!.toLowerCase()) || w.Number === p.FindByString);
        const limit = Number(p.Limit ?? 500);
        const page = Number(p.Page ?? 1);
        return ok(list.slice((page - 1) * limit, page * limit), list.length);
      }
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({success: false, data: [], errors: ['Method not supported by test adapter']}));
    });
  });
  await new Promise<void>(r => server.listen(port, '0.0.0.0', r));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}/v2.0/json/`,
    calls,
    setDown: d => void (down = d),
    close: () => new Promise(r => server.close(() => r())),
  };
}
