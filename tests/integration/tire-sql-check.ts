/**
 * Tyre-service checks of the SQL layer, run inside ONE transaction that is
 * always rolled back — safe against the linked cloud database:
 *
 *   npx tsx tests/integration/tire-sql-check.ts            # migration already applied
 *   npx tsx tests/integration/tire-sql-check.ts --apply    # apply supabase/migrations/*_tire_service.sql
 *                                                          # inside the transaction first (pre-push check)
 *   npx tsx tests/integration/tire-sql-check.ts --db <postgres-url>   # another database (local stack)
 *
 * What it proves:
 *   1. --apply: availability and the public card of existing studios are the same before and after the migration;
 *   2. private.tire_quote equals quote() from supabase/functions/_shared/tire.ts on a full grid;
 *   3. calculator availability uses the quoted duration, 15-min steps, closing time and the season horizon;
 *   4. a seasonal post is free only inside a season;
 *   5. a calculator booking stores the server price, label, plate and tyre source; a plate is required;
 *      a plain booking keeps its old request fingerprint;
 *   6. the tyre hotel: owner insert through RLS (plate/phone normalised by the trigger), the public lookup needs
 *      both phone and plate, the owner list marks who is due for the season;
 *   7. walk-in takes the nearest free slot; seasons are validated.
 */
import {randomBytes, randomUUID} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import pg from 'pg';
import {businessSchema} from '../../shared/business.ts';
import {toSyncPayload} from '../../scripts/lib/payload.ts';
import {ROOT} from '../../scripts/lib/tenants.ts';
import {DIAMETERS, RIMS, VEHICLES, quote, type TireConfig} from '../../supabase/functions/_shared/tire.ts';

const {values} = parseArgs({options: {apply: {type: 'boolean', default: false}, db: {type: 'string'}}});

function connectionString(): string {
  if (values.db) return values.db;
  const envFile = path.join(ROOT, '.env.publish');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const conn = new URL(readFileSync(path.join(ROOT, 'supabase', '.temp', 'pooler-url'), 'utf8').trim());
  conn.password = process.env.SUPABASE_DB_PASSWORD!;
  return conn.toString();
}

const client = new pg.Client({connectionString: connectionString(), ssl: values.db ? undefined : {rejectUnauthorized: false}});
await client.connect();
const q = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await client.query(sql, args)).rows as T[];
const one = async <T = any>(sql: string, args: unknown[] = []): Promise<T> => (await q<T>(sql, args))[0]!;
let failures = 0;
const check = (ok: boolean, label: string, detail?: unknown) => {
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures++;
};
/** Runs a statement expected to fail; returns the error's message (the machine code). */
const failsWith = async (sql: string, args: unknown[]) => {
  await client.query('savepoint expect_fail');
  try {
    await client.query(sql, args);
    await client.query('release savepoint expect_fail');
    return null;
  } catch (e) {
    await client.query('rollback to savepoint expect_fail');
    return (e as Error).message;
  }
};
const md = (d: Date) => d.toISOString().slice(5, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

await client.query('begin');
try {
  // ---------------------------------------------------------------- 1. regression
  const legacy = await q<{slug: string; service: string}>(
    `select t.slug, (select s.id from public.services s where s.tenant_id = t.id and s.is_active order by s.sort limit 1) as service
       from public.tenants t where t.status in ('preview', 'live') and t.kind <> 'tireservice' order by t.created_at limit 4`,
  );
  const snapshot = async () =>
    Promise.all(
      legacy.map(async l => ({
        avail: (await one(`select public.public_get_availability($1, $2, null, 7) as a`, [l.slug, l.service])).a,
        card: (await one(`select public.public_get_tenant($1) as c`, [l.slug])).c,
      })),
    );
  const before = values.apply ? await snapshot() : null;
  if (values.apply) {
    const file = readdirSync(path.join(ROOT, 'supabase', 'migrations')).find(f => f.endsWith('_tire_service.sql'))!;
    await client.query(readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8'));
    console.log(`• applied ${file} inside the transaction`);
    const after = await snapshot();
    legacy.forEach((l, i) => {
      check(JSON.stringify(after[i]!.avail) === JSON.stringify(before![i]!.avail), `${l.slug}: availability unchanged`);
      const {tire, tire_seasons, ...rest} = after[i]!.card;
      const {effective_horizon_days, ...booking} = rest.booking;
      check(
        JSON.stringify({...rest, booking}) === JSON.stringify(before![i]!.card) && tire === null && effective_horizon_days === before![i]!.card.booking.horizon_days,
        `${l.slug}: public card unchanged apart from new tyre fields`,
      );
    });
  }

  // ---------------------------------------------------------------- tenant
  const demo = JSON.parse(readFileSync(path.join(ROOT, 'tenants', 'pneuservis-ukazka', 'business.json'), 'utf8'));
  const slug = `t-tire-${randomBytes(3).toString('hex')}`;
  const today = new Date();
  // A season running now (shorter horizon) and one far from today.
  demo.tire.seasons = [
    {from: md(addDays(today, -3)), to: md(addDays(today, 8)), mount: 'winter', horizonDays: 5},
    {from: md(addDays(today, 120)), to: md(addDays(today, 160)), mount: 'summer'},
  ];
  demo.closedDates = [];
  demo.hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, [['07:30', '16:30']]]));
  const config = businessSchema.parse({...demo, slug});
  await q(`select public.svc_sync_tenant($1::jsonb, 'test', false)`, [JSON.stringify(toSyncPayload(config))]);
  const card = (await one(`select public.public_get_tenant($1) as c`, [slug])).c;
  const tenantId: string = card.id;
  const svc = Object.fromEntries((card.services as {key: string; id: string; duration_minutes: number}[]).map(s => [s.key, s]));
  check(card.kind === 'tireservice' && card.tire?.operations?.length === 5 && card.tire_seasons.length === 2, 'tenant synced with the matrix and seasons');
  check(card.booking.effective_horizon_days === 5 && card.booking.horizon_days === 30, 'season horizon 5 of 30 days', card.booking);

  // ---------------------------------------------------------------- 2. price grid
  const tire = card.tire as TireConfig;
  const grid: {service: string; key: string; p: {vehicle: string; rim: string; diameter: number; wheels: number}}[] = [];
  for (const op of tire.operations)
    for (const vehicle of VEHICLES) for (const rim of RIMS) for (const diameter of DIAMETERS) for (const wheels of [1, 2, 3, 4, 5, 8])
      grid.push({service: svc[op.service]!.id, key: op.service, p: {vehicle, rim, diameter, wheels}});
  const sqlQuotes = await q<{i: number; r: any}>(
    `select (x ->> 'i')::int as i, private.tire_quote($1, (x ->> 'service')::uuid, x -> 'p') as r
       from jsonb_array_elements($2::jsonb) x`,
    [tenantId, JSON.stringify(grid.map((g, i) => ({...g, i})))],
  );
  const mismatches = sqlQuotes.filter(({i, r}) => {
    const g = grid[i]!;
    const ts = quote(tire.operations.find(o => o.service === g.key)!, g.p as never, svc[g.key]!.duration_minutes);
    return ts.price !== r.price || ts.onRequest !== r.on_request || ts.durationMinutes !== r.duration_minutes || ts.wheels !== r.wheels;
  });
  check(mismatches.length === 0, `SQL and TS quotes agree on ${grid.length} combinations`, mismatches.slice(0, 3));
  const suv17 = (await one(`select private.tire_quote($1, $2, '{"vehicle":"suv","rim":"alloy","diameter":17,"wheels":4}') as r`, [tenantId, svc['prezuti-kol']!.id])).r;
  check(suv17.price === 750 && suv17.duration_minutes === 60 && suv17.label === 'Přezutí kompletních kol + vyvážení — SUV / 4×4, Alu R17, 4×', 'SUV alu R17: 750 Kč, 60 min, label', suv17);
  const van21 = (await one(`select private.tire_quote($1, $2, '{"vehicle":"van","rim":"alloy","diameter":21}') as r`, [tenantId, svc['prezuti-kol']!.id])).r;
  check(van21.on_request === true && van21.price === 0, 'van R21: price on request', van21);
  check(
    (await failsWith(`select private.tire_quote($1, $2, '{"vehicle":"bus","rim":"alloy","diameter":17}')`, [tenantId, svc['prezuti-kol']!.id]))?.includes('INVALID_TIRE_PARAMS') ?? false,
    'unknown vehicle is rejected',
  );

  // ---------------------------------------------------------------- 3. availability
  const params = {vehicle: 'suv', rim: 'alloy', diameter: 17, wheels: 4};
  const av = (await one(`select public.public_get_tire_availability($1, $2, $3::jsonb, null, 14) as a`, [slug, svc['prezuti-kol']!.id, JSON.stringify(params)])).a;
  const slots: {start_at: string; available: boolean}[] = av.days.flatMap((d: any) => d.slots);
  const local = (iso: string) => new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(iso));
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
  check(av.quote.price === 750 && av.service.duration_minutes === 60, 'availability carries the quote and its duration');
  check(slots.length > 0 && slots.every(s => toMin(local(s.start_at)) % 15 === 0), '15-minute steps');
  check(slots.every(s => toMin(local(s.start_at)) + 60 <= 16 * 60 + 30), 'a 60-min job ends before 16:30');
  check(av.days.length <= 5, `season horizon: ${av.days.length} day(s) ≤ 5`);

  // ---------------------------------------------------------------- 4. seasonal post
  const res = Object.fromEntries((await q<{key: string; id: string; seasonal: boolean}>(`select key, id, seasonal from public.resources where tenant_id = $1`, [tenantId])).map(r => [r.key, r]));
  check(res['zvedak-3']?.seasonal === true && res['zvedak-1']?.seasonal === false, 'seasonal flag synced from business.json');
  const freeAt = async (day: Date) => {
    const start = new Date(`${day.toISOString().slice(0, 10)}T09:00:00Z`);
    const period = `[${start.toISOString()},${new Date(start.getTime() + 3_600_000).toISOString()})`;
    await q(`insert into public.resource_occupancies (tenant_id, resource_id, kind, period) values ($1, $2, 'block', $4::tstzrange), ($1, $3, 'block', $4::tstzrange)`, [
      tenantId, res['zvedak-1']!.id, res['zvedak-2']!.id, period,
    ]);
    return (await one(`select private.free_resource_count($1, $2, $3::tstzrange) as n`, [tenantId, svc['prezuti-kol']!.id, period])).n as number;
  };
  check((await freeAt(addDays(today, 2))) === 1, 'in season: the seasonal post is free when the others are taken');
  check((await freeAt(addDays(today, 40))) === 0, 'off season: the seasonal post takes nothing');

  // ---------------------------------------------------------------- 5. bookings
  const free = slots.find(s => s.available)!;
  const tireArgs = {...params, plate: '1t2 3456', tire_size: '235/55 R17', tire_source: 'storage'};
  const booked = (await one(
    `select public.public_create_tire_booking($1, $2, $3, 'Test Tire', '+420777000111', 'Škoda Kodiaq', '', $4, $5::jsonb) as r`,
    [slug, svc['prezuti-kol']!.id, free.start_at, randomBytes(18).toString('base64url'), JSON.stringify(tireArgs)],
  )).r.booking;
  check(
    booked.price === 750 && booked.duration_minutes === 60 && booked.plate === '1T23456' && booked.tire_source === 'storage' && booked.service_name.includes('SUV / 4×4, Alu R17'),
    'calculator booking stores server price, label, plate and source',
    booked,
  );
  const noPlate = await failsWith(`select public.public_create_tire_booking($1, $2, $3, 'Test Tire', '+420777000112', 'Škoda', '', $4, $5::jsonb)`, [
    slug, svc['prezuti-kol']!.id, slots.filter(s => s.available)[3]!.start_at, randomBytes(18).toString('base64url'), JSON.stringify(params),
  ]);
  check(noPlate?.includes('INVALID_PLATE') ?? false, 'a calculator booking needs a plate', noPlate);
  const plainKey = randomBytes(18).toString('base64url');
  const plainSlot = slots.filter(s => s.available).at(-1)!.start_at;
  const plain = (await one(`select public.public_create_booking($1, $2, $3, 'Plain Test', '+420777000113', 'Fabia', '', $4) as r`, [slug, svc['vyvazeni']!.id, plainSlot, plainKey])).r.booking;
  const fp = await one(
    `select b.request_fingerprint = encode(extensions.digest(concat_ws('|', b.service_id, b.start_at, b.customer_phone), 'sha256'), 'hex') as same
       from public.bookings b where b.id = $1`,
    [plain.id],
  );
  check(plain.price === 400 && plain.plate === null && fp.same, 'plain booking: service price, no plate, old fingerprint formula');

  // ---------------------------------------------------------------- 6–7. owner side, as an authenticated member
  const uid = randomUUID();
  await q(`insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`, [uid, `tire-check-${uid.slice(0, 8)}@example.com`]);
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`, [tenantId, uid]);
  await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({sub: uid, role: 'authenticated'})]);
  await q(`set local role authenticated`);
  const set = await one(
    `insert into public.tire_sets (tenant_id, customer_name, customer_phone, plate, tire_size, season, with_rims, tread_mm, location)
     values ($1, 'Test Tire', '+420 777 000 111', '1t2-3456', '235/55 R17', 'winter', true, 6.5, 'A-12') returning plate, customer_phone`,
    [tenantId],
  );
  await q(
    `insert into public.tire_sets (tenant_id, customer_name, customer_phone, plate, season) values ($1, 'Due Customer', '+420777000222', '2AB0001', 'winter'), ($1, 'Summer Set', '+420777000333', '3AB0001', 'summer')`,
    [tenantId],
  );
  check(set.plate === '1T23456' && set.customer_phone === '+420777000111', 'owner insert through RLS, plate and phone normalised');
  const list = (await one(`select public.owner_tire_sets($1) as r`, [tenantId])).r;
  const byPlate = Object.fromEntries((list.sets as any[]).map(s => [s.plate, s]));
  check(list.season?.mount === 'winter', 'owner list knows the running season', list.season);
  check(byPlate['1T23456']?.due === false && byPlate['1T23456']?.next_booking_at, 'booked customer is not due');
  check(byPlate['2AB0001']?.due === true && byPlate['3AB0001']?.due === false, 'winter set without a booking is due; summer set is not');
  const walk = (await one(`select public.owner_walk_in($1, $2, '{"vehicle":"car","rim":"steel","diameter":15,"plate":"4AB0001"}', 'Walk In', '+420777000444', 'Octavia', '', $3) as r`, [
    tenantId, svc['defekt']!.id, randomBytes(18).toString('base64url'),
  ])).r;
  check(
    walk.source === 'owner' && walk.plate === '4AB0001' && new Date(walk.start_at).getTime() >= Date.now() - 15 * 60_000 && walk.price === 500,
    `walk-in placed at ${local(walk.start_at)} (${walk.start_at.slice(0, 10)})`,
    walk,
  );
  const badSeason = await failsWith(`select public.owner_set_tire_seasons($1, '[{"from":"13-01","to":"11-30","mount":"winter"}]')`, [tenantId]);
  check(badSeason?.includes('INVALID_SEASONS') ?? false, 'invalid season dates are rejected');
  const seasons = (await one(`select public.owner_set_tire_seasons($1, '[{"from":"10-15","to":"11-30","mount":"winter","horizonDays":14}]') as r`, [tenantId])).r;
  check(seasons.length === 1 && seasons[0].horizonDays === 14, 'owner saves seasons');
  await q(`reset role`);

  const found = (await one(`select public.public_tire_storage_lookup($1, '+420 777 000 111', '1T2 3456') as r`, [slug])).r;
  const wrong = (await one(`select public.public_tire_storage_lookup($1, '+420 777 000 999', '1T2 3456') as r`, [slug])).r;
  check(found.length === 1 && found[0].season === 'winter' && !('customer_name' in found[0]) && wrong.length === 0, 'storage lookup needs phone AND plate, returns no personal data');
} catch (e) {
  failures++;
  console.error('✗ unexpected error:', (e as Error).message);
} finally {
  await client.query('rollback');
  await client.end();
  console.log(`• rolled back${failures ? `; ${failures} check(s) failed` : '; all checks passed'}`);
  process.exit(failures ? 1 : 0);
}
