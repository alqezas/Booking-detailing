/**
 * Car-wash checks of the SQL layer, in ONE transaction that is always rolled
 * back — safe against the linked cloud database (same flags as tire-sql-check.ts):
 *
 *   npx tsx tests/integration/wash-sql-check.ts [--apply] [--db <postgres-url>]
 *
 *   1. --apply: plain studios (availability, public card) and the tyre demo
 *      (priced availability) are the same before and after the migration;
 *   2. private.wash_quote equals washQuote() from supabase/functions/_shared/wash.ts
 *      on every program × class × subset of extras;
 *   3. peak hours: walk-in-only windows are closed online but open to the owner;
 *      a «limit» window takes N parallel online bookings;
 *   4. a wash booking stores the server price/label and the plate (required by the studio);
 *   5. wash passes: a ready booking takes one wash, undoing gives it back; the public
 *      lookup needs phone AND plate; walk-ins ignore peak hours; peak rules are validated.
 */
import {randomBytes, randomUUID} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import pg from 'pg';
import {businessSchema} from '../../shared/business.ts';
import {toSyncPayload} from '../../scripts/lib/payload.ts';
import {ROOT} from '../../scripts/lib/tenants.ts';
import {CAR_CLASSES, programFor, washQuote, type WashConfig} from '../../supabase/functions/_shared/wash.ts';

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
const key = () => randomBytes(18).toString('base64url');

await client.query('begin');
try {
  // ---------------------------------------------------------------- 1. regression
  const legacy = await q<{slug: string; service: string}>(
    `select t.slug, (select s.id from public.services s where s.tenant_id = t.id and s.is_active order by s.sort limit 1) as service
       from public.tenants t where t.status in ('preview', 'live') and t.kind in ('detailing', 'autoservice') order by t.created_at limit 4`,
  );
  const tireDemo = await one<{id: string; service: string} | undefined>(
    `select t.id, (select s.id from public.services s where s.tenant_id = t.id and s.key = 'prezuti-kol') as service from public.tenants t where t.slug = 'pneuservis-ukazka'`,
  );
  const snapshot = async () => ({
    legacy: await Promise.all(
      legacy.map(async l => ({
        avail: (await one(`select public.public_get_availability($1, $2, null, 7) as a`, [l.slug, l.service])).a,
        card: (await one(`select public.public_get_tenant($1) as c`, [l.slug])).c,
      })),
    ),
    tire: tireDemo
      ? (await one(`select public.public_get_tire_availability('pneuservis-ukazka', $1, '{"vehicle":"suv","rim":"alloy","diameter":17,"wheels":4}', null, 7) as a`, [tireDemo.service])).a
      : null,
  });
  if (values.apply) {
    const before = await snapshot();
    const file = readdirSync(path.join(ROOT, 'supabase', 'migrations')).find(f => f.endsWith('_car_wash.sql'))!;
    await client.query(readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8'));
    console.log(`• applied ${file} inside the transaction`);
    const after = await snapshot();
    legacy.forEach((l, i) => {
      check(JSON.stringify(after.legacy[i]!.avail) === JSON.stringify(before.legacy[i]!.avail), `${l.slug}: availability unchanged`);
      const {wash, peak_hours, ...rest} = after.legacy[i]!.card;
      check(JSON.stringify(rest) === JSON.stringify(before.legacy[i]!.card) && wash === null && peak_hours.length === 0, `${l.slug}: public card unchanged apart from new fields`);
    });
    if (before.tire) {
      const {quote: qa, ...a} = after.tire;
      const {quote: qb, ...b} = before.tire;
      const {kind, ...qaRest} = qa;
      check(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(qaRest) === JSON.stringify(qb) && kind === 'tire', 'tyre demo: priced availability unchanged (quote gains kind = tire)');
    }
  }

  // ---------------------------------------------------------------- tenant
  const demo = JSON.parse(readFileSync(path.join(ROOT, 'tenants', 'myti-ukazka', 'business.json'), 'utf8'));
  const slug = `t-wash-${randomBytes(3).toString('hex')}`;
  const all = [1, 2, 3, 4, 5, 6, 7];
  demo.booking.peakHours = [
    {days: all, from: '08:00', to: '10:00', mode: 'walkin'},
    {days: all, from: '12:00', to: '14:00', mode: 'limit', posts: 1},
  ];
  demo.closedDates = [];
  demo.hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, [['07:00', '18:00']]]));
  const config = businessSchema.parse({...demo, slug});
  await q(`select public.svc_sync_tenant($1::jsonb, 'test', false)`, [JSON.stringify(toSyncPayload(config))]);
  const card = (await one(`select public.public_get_tenant($1) as c`, [slug])).c;
  const tenantId: string = card.id;
  const svc = Object.fromEntries((card.services as {key: string; id: string; duration_minutes: number}[]).map(s => [s.key, s]));
  check(card.kind === 'carwash' && card.wash?.programs?.length === 4 && card.peak_hours.length === 2, 'wash tenant synced with programs and peak hours');

  // ---------------------------------------------------------------- 2. price grid
  const wash = card.wash as WashConfig;
  const keys = wash.extras.map(e => e.key);
  const subsets = Array.from({length: 1 << keys.length}, (_, m) => keys.filter((_, i) => m & (1 << i)));
  const grid = wash.programs.flatMap(p => CAR_CLASSES.flatMap(c => subsets.map(extras => ({key: p.service, service: svc[p.service]!.id, p: {class: c, extras}}))));
  const sql = await q<{i: number; r: any}>(
    `select (x ->> 'i')::int as i, private.wash_quote($1, (x ->> 'service')::uuid, x -> 'p') as r from jsonb_array_elements($2::jsonb) x`,
    [tenantId, JSON.stringify(grid.map((g, i) => ({...g, i})))],
  );
  const bad = sql.filter(({i, r}) => {
    const g = grid[i]!;
    const ts = washQuote(wash, programFor(wash, g.key)!, g.p, svc[g.key]!.duration_minutes);
    return ts.price !== r.price || ts.onRequest !== r.on_request || ts.durationMinutes !== r.duration_minutes;
  });
  check(bad.length === 0, `SQL and TS wash quotes agree on ${grid.length} combinations`, bad.slice(0, 3));
  const suvWax = (await one(`select private.priced_quote($1, $2, '{"class":"suv","extras":["vosk","nope","vosk"]}') as r`, [tenantId, svc['kompletni']!.id])).r;
  check(
    suvWax.kind === 'wash' && suvWax.price === 3600 && suvWax.duration_minutes === 195 && suvWax.label === 'Kompletní mytí — SUV / MPV + Tvrdý vosk' && JSON.stringify(suvWax.extras) === '["vosk"]',
    'SUV complete wash + wax: 3 600 Kč, 195 min; unknown and repeated extras ignored',
    suvWax,
  );
  const vanInt = (await one(`select private.wash_quote($1, $2, '{"class":"van","extras":[]}') as r`, [tenantId, svc['interier']!.id])).r;
  check(vanInt.on_request && vanInt.price === 0 && vanInt.duration_minutes === 90, 'van interior: price on request', vanInt);
  check((await failsWith(`select private.wash_quote($1, $2, '{"class":"bus"}')`, [tenantId, svc['venkovni']!.id]))?.includes('INVALID_WASH_PARAMS') ?? false, 'unknown class is rejected');

  // ---------------------------------------------------------------- 3. peak hours
  const at = async (hhmm: string) => (await one(`select ((current_date + 2)::timestamp + $1::time) at time zone 'Europe/Prague' as t`, [hhmm])).t as Date;
  const params = JSON.stringify({class: 'medium', extras: [], plate: '5AB0001'});
  const pub = (await one(`select public.public_get_tire_availability($1, $2, $3::jsonb, current_date + 2, 1) as a`, [slug, svc['venkovni']!.id, params])).a;
  const own = (await one(`select private.availability_core($1, $2, 60, current_date + 2, 1, false) as a`, [tenantId, svc['venkovni']!.id])).a;
  const local = (iso: string) => new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(iso));
  const slotsAt = (a: any, pred: (hm: string) => boolean) => a.days[0].slots.filter((s: any) => pred(local(s.start_at)));
  check(slotsAt(pub, hm => hm >= '08:00' && hm < '10:00').every((s: any) => !s.available), 'walk-in window 08–10: no online slots');
  check(slotsAt(own, hm => hm >= '08:00' && hm < '10:00').every((s: any) => s.available), 'walk-in window 08–10: the owner sees free posts');
  check(slotsAt(pub, hm => hm >= '10:00' && hm < '11:00').every((s: any) => s.available), 'after the window online slots are back');
  const closed = await failsWith(`select public.public_create_tire_booking($1, $2, $3, 'Peak Test', '+420777100001', 'Octavia', '', $4, $5::jsonb)`, [
    slug, svc['venkovni']!.id, await at('08:30'), key(), params,
  ]);
  check(closed?.includes('ONLINE_CLOSED') ?? false, 'online booking inside the walk-in window is refused', closed);
  const first = (await one(`select public.public_create_tire_booking($1, $2, $3, 'Limit One', '+420777100002', 'Octavia', '', $4, $5::jsonb) as r`, [
    slug, svc['venkovni']!.id, await at('12:00'), key(), params,
  ])).r.booking;
  const second = await failsWith(`select public.public_create_tire_booking($1, $2, $3, 'Limit Two', '+420777100003', 'Fabia', '', $4, $5::jsonb)`, [
    slug, svc['venkovni']!.id, await at('12:15'), key(), JSON.stringify({class: 'small', extras: [], plate: '5AB0002'}),
  ]);
  check(!!first.id && (second?.includes('ONLINE_CLOSED') ?? false), '«limit 1» window: the first online booking passes, a parallel second one is refused', second);
  const pub2 = (await one(`select public.public_get_tire_availability($1, $2, $3::jsonb, current_date + 2, 1) as a`, [slug, svc['venkovni']!.id, params])).a;
  check(slotsAt(pub2, hm => hm === '12:30').every((s: any) => !s.available) && slotsAt(pub2, hm => hm === '14:00').every((s: any) => s.available), 'the limit shows in the public slots');

  // ---------------------------------------------------------------- 4. booking
  check(
    first.price === 800 && first.duration_minutes === 60 && first.plate === '5AB0001' && first.tire_params.kind === 'wash' && first.service_name === 'Ruční mytí exteriéru — Střední',
    'wash booking stores the server price, label, plate and parameters',
    first,
  );
  const noPlate = await failsWith(`select public.public_create_tire_booking($1, $2, $3, 'No Plate', '+420777100004', 'Fabia', '', $4, '{"class":"small","extras":[]}')`, [
    slug, svc['venkovni']!.id, await at('15:00'), key(),
  ]);
  check(noPlate?.includes('INVALID_PLATE') ?? false, 'the studio requires a plate', noPlate);

  // ---------------------------------------------------------------- 5. passes and the owner
  const uid = randomUUID();
  await q(`insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`, [uid, `wash-check-${uid.slice(0, 8)}@example.com`]);
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`, [tenantId, uid]);
  await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({sub: uid, role: 'authenticated'})]);
  await q(`set local role authenticated`);
  const pass = await one(`insert into public.wash_passes (tenant_id, customer_name, customer_phone, plate, total) values ($1, 'Limit One', '+420 777 100 002', '5ab-0001', 2) returning id, plate, customer_phone`, [tenantId]);
  check(pass.plate === '5AB0001' && pass.customer_phone === '+420777100002', 'owner sells a pass through RLS, plate and phone normalised');
  await q(`select public.owner_set_booking_status($1, 'ready')`, [first.id]);
  let passes = (await one(`select public.owner_wash_passes($1) as r`, [tenantId])).r;
  const ownerBooking = (await one(`select public.owner_booking($1) as r`, [first.id])).r;
  check(passes[0].remaining === 1 && passes[0].used === 1 && ownerBooking.pass?.remaining === 1, 'ready booking takes one wash from the pass', {passes, pass: ownerBooking.pass});
  await q(`select public.owner_set_booking_status($1, 'arrived')`, [first.id]);
  passes = (await one(`select public.owner_wash_passes($1) as r`, [tenantId])).r;
  check(passes[0].remaining === 2, 'undoing «ready» gives the wash back');
  const walk = (await one(`select public.owner_walk_in($1, $2, $3::jsonb, 'Walk In', '+420777100005', 'Superb', '', $4) as r`, [tenantId, svc['venkovni']!.id, params, key()])).r;
  check(walk.source === 'owner' && walk.tire_params?.kind === 'wash', `walk-in placed at ${local(walk.start_at)} on ${walk.start_at.slice(0, 10)}`, walk);
  const ownerPeak = (await one(`select public.owner_create_tire_booking($1, $2, $3, 'Owner Peak', '+420777100006', 'Superb', '', $4::jsonb, $5) as r`, [
    tenantId, svc['venkovni']!.id, await at('08:30'), params, key(),
  ])).r;
  check(ownerPeak.source === 'owner' && local(ownerPeak.start_at) === '08:30', 'the owner books inside the walk-in window');
  const badPeak = await failsWith(`select public.owner_set_peak_hours($1, '[{"days":[8],"from":"10:00","to":"09:00","mode":"walkin"}]')`, [tenantId]);
  check(badPeak?.includes('INVALID_PEAK_HOURS') ?? false, 'invalid peak rules are rejected');
  const saved = (await one(`select public.owner_set_peak_hours($1, '[{"days":[6],"from":"08:00","to":"12:00","mode":"walkin","posts":5}]') as r`, [tenantId])).r;
  check(saved.length === 1 && saved[0].posts === null, 'owner saves peak hours (posts only for «limit»)', saved);
  await q(`reset role`);
  const found = (await one(`select public.public_wash_pass_lookup($1, '+420777100002', '5AB 0001') as r`, [slug])).r;
  const wrong = (await one(`select public.public_wash_pass_lookup($1, '+420777100002', '9ZZ9999') as r`, [slug])).r;
  check(found.length === 1 && found[0].remaining === 2 && !('customer_name' in found[0]) && wrong.length === 0, 'pass lookup needs phone AND plate, returns no personal data', found);
} catch (e) {
  failures++;
  console.error('✗ unexpected error:', (e as Error).message);
} finally {
  await client.query('rollback');
  await client.end();
  console.log(`• rolled back${failures ? `; ${failures} check(s) failed` : '; all checks passed'}`);
  process.exit(failures ? 1 : 0);
}
