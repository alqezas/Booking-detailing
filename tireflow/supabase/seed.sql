-- TireFlow · LOCAL / STAGING DEMO SEED — synthetic data only, never run against production.
-- `supabase db reset` applies it automatically. Production uses migrations only.
--
-- Demo logins (all share the password below; local development only):
--   admin@tireflow.test       platform super admin (no tenant data access)
--   owner@tireflow.test       owner of "TireFlow — Demo Tire Service"
--   manager@tireflow.test     manager
--   mechanic@tireflow.test    mechanic (sees only assigned work, no money)
--   accountant@tireflow.test  accountant
--   other@tireflow.test       owner of a second tenant, used by isolation tests
-- Password: TireFlow-demo-2026

do $seed$
declare
  v_pw text := extensions.crypt('TireFlow-demo-2026', extensions.gen_salt('bf'));
  u_admin uuid := '00000000-0000-4000-a000-000000000001';
  u_owner uuid := '00000000-0000-4000-a000-000000000002';
  u_manager uuid := '00000000-0000-4000-a000-000000000003';
  u_mech uuid := '00000000-0000-4000-a000-000000000004';
  u_acc uuid := '00000000-0000-4000-a000-000000000005';
  u_other uuid := '00000000-0000-4000-a000-000000000006';
  b uuid := '10000000-0000-4000-a000-000000000001';
  b2 uuid := '10000000-0000-4000-a000-000000000002';
  br1 uuid; br2 uuid; br_other uuid;
  wh_stock1 uuid; wh_stock2 uuid; wh_hotel uuid;
  ws uuid[]; emp uuid[]; svc uuid[]; prod uuid[]; cust uuid[]; veh uuid[]; corp uuid[];
  cat_car uuid; cat_suv uuid; cat_van uuid;
  m_cash uuid; m_card uuid; m_transfer uuid;
  first_names text[] := array['Jan','Petr','Tomáš','Lukáš','Martin','Jakub','Ondřej','Pavel','Marek','Michal',
    'Anna','Eva','Lucie','Kateřina','Tereza','Jana','Petra','Zuzana','Olena','Iryna','Andrii','Oleksandr',
    'Piotr','Krzysztof','Agnieszka','Magdalena','Stefan','Lukas','Sabine','Matej','Juraj','Monika'];
  last_names text[] := array['Novák','Svoboda','Dvořák','Černý','Procházka','Kučera','Veselý','Horák','Němec',
    'Marek','Pokorný','Král','Kowalski','Nowak','Wiśniewski','Kovalenko','Shevchenko','Bondarenko','Horvát',
    'Varga','Huber','Gruber','Bauer','Tkachenko','Zieliński','Kováč','Baláž'];
  makes text[] := array['Škoda','Volkswagen','Toyota','Hyundai','Ford','Renault','BMW','Audi','Kia','Peugeot','Dacia','Mercedes-Benz'];
  models text[] := array['Octavia','Fabia','Golf','Passat','Corolla','RAV4','Tucson','i30','Focus','Clio','X3','A4','Sportage','308','Duster','Vito'];
  i int; j int; k int;
  v_c uuid; v_v uuid; v_o uuid; v_set uuid; v_loc uuid; v_contract uuid;
  v_day date; v_start timestamptz; v_rim int; v_status text;
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  perform setseed(0.42);

  -- ── auth users
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email, v_pw, now(),
         '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', x.name, 'locale', x.loc),
         now(), now(), '', '', '', ''
  from (values (u_admin, 'admin@tireflow.test', 'Platform Admin', 'en'),
               (u_owner, 'owner@tireflow.test', 'Olga Owner', 'en'),
               (u_manager, 'manager@tireflow.test', 'Marek Manager', 'cs'),
               (u_mech, 'mechanic@tireflow.test', 'Michal Mechanic', 'cs'),
               (u_acc, 'accountant@tireflow.test', 'Alena Accountant', 'en'),
               (u_other, 'other@tireflow.test', 'Otto Other', 'de')) x(id, email, name, loc);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
  from auth.users u where u.email like '%@tireflow.test';

  insert into public.platform_admins (user_id) values (u_admin);

  -- ── business + bootstrap
  insert into public.businesses (id, slug, name, legal_name, is_demo, license_kind)
  values (b, 'tireflow-demo', 'TireFlow — Demo Tire Service', 'TireFlow Demo s.r.o.', true, 'internal');
  perform private.bootstrap_business(b, 'en', 'CZK');
  update public.business_settings set phone = '+420 777 000 111', email = 'hello@tireflow.test',
    website = 'https://tireflow.test', public_locale = 'cs', storage_price_per_season = 150000,
    brand_color = '#0f766e', accent_color = '#f59e0b', order_number_prefix = 'TF'
   where business_id = b;
  update public.business_modules set enabled = true where business_id = b and module = 'corporate';

  insert into public.branches (business_id, name, address_line, city, postal_code, country, phone, sort_order)
  values (b, 'Praha — Vysočany', 'Kolbenova 12', 'Praha 9', '190 00', 'CZ', '+420 777 000 111', 1) returning id into br1;
  insert into public.branches (business_id, name, address_line, city, postal_code, country, phone, sort_order)
  values (b, 'Brno — Královo Pole', 'Purkyňova 45', 'Brno', '612 00', 'CZ', '+420 777 000 222', 2) returning id into br2;

  insert into public.workstations (business_id, branch_id, name, equipment, sort_order, kind)
  select b, d.branch, d.name, d.eq, d.sort_order, case when d.sort_order = 3 then 'express' else 'general' end
  from (values
      (1, 'Post 1', br1, array['lift','balancer','changer']::text[]), (2, 'Post 2', br1, array['lift','balancer','changer']),
      (3, 'Post 3 · Express', br1, array['changer','balancer']), (4, 'Post 1', br2, array['lift','balancer','changer']),
      (5, 'Post 2 · SUV/Van', br2, array['lift','balancer','changer','truck_lift'])) d(sort_order, name, branch, eq);
  select array_agg(id order by sort_order) into ws from public.workstations where business_id = b;

  insert into public.branch_closures (business_id, branch_id, day, reason)
  values (b, br1, make_date(extract(year from v_today)::int, 12, 25), 'Christmas'),
         (b, br2, make_date(extract(year from v_today)::int, 12, 25), 'Christmas');

  select id into cat_car from public.vehicle_categories where business_id = b and code = 'car';
  select id into cat_suv from public.vehicle_categories where business_id = b and code = 'suv';
  select id into cat_van from public.vehicle_categories where business_id = b and code = 'van';
  update public.workstations set max_vehicle_category_codes = array['car', 'moto'] where id = ws[3];
  select id into m_cash from public.payment_methods where business_id = b and code = 'cash';
  select id into m_card from public.payment_methods where business_id = b and code = 'card';
  select id into m_transfer from public.payment_methods where business_id = b and code = 'transfer';

  -- ── memberships + employees (8)
  insert into public.memberships (business_id, user_id, role) values
    (b, u_owner, 'owner'), (b, u_manager, 'manager'), (b, u_mech, 'mechanic'), (b, u_acc, 'accountant');

  insert into public.employees (business_id, branch_id, membership_id, first_name, last_name, position, skills, color, commission_bp, created_at)
  select b, e.branch, (select id from public.memberships where business_id = b and user_id = e.uid),
         e.fn, e.ln, e.pos, e.skills, e.color, case when e.n <= 6 then 500 else 0 end, now() + make_interval(secs => e.n)
  from (values
      (1, 'Michal', 'Dvořák', 'Senior mechanic', br1, array['tpms','runflat','rims'], '#2563eb', u_mech),
      (2, 'Tomáš', 'Král', 'Mechanic', br1, array['tpms'], '#16a34a', null),
      (3, 'Andrii', 'Kovalenko', 'Mechanic', br1, array['runflat'], '#9333ea', null),
      (4, 'Lukáš', 'Veselý', 'Apprentice', br1, '{}', '#ea580c', null),
      (5, 'Piotr', 'Nowak', 'Senior mechanic', br2, array['tpms','runflat','rims'], '#0891b2', null),
      (6, 'Juraj', 'Baláž', 'Mechanic', br2, array['tpms'], '#db2777', null),
      (7, 'Marek', 'Horák', 'Shift manager', br1, array['tpms'], '#475569', u_manager),
      (8, 'Eva', 'Černá', 'Receptionist', br2, '{}', '#ca8a04', null)) e(n, fn, ln, pos, branch, skills, color, uid);
  select array_agg(id order by created_at) into emp from public.employees where business_id = b;

  insert into public.employee_schedules (business_id, employee_id, weekday, starts, ends)
  select b, emp[e], d, '08:00', '17:00' from generate_series(1, 8) e, generate_series(1, 5) d;
  insert into public.employee_absences (business_id, employee_id, kind, during)
  values (b, emp[4], 'vacation', tstzrange((v_today + 10)::timestamp at time zone 'Europe/Prague', (v_today + 17)::timestamp at time zone 'Europe/Prague'));

  -- ── services
  insert into public.services (business_id, category_id, name, unit, base_price, base_duration_min, online_bookable, required_equipment, sort_order)
  select b, (select id from public.service_categories where business_id = b and code = s.cat), s.name, s.unit, s.price, s.dur, s.online, s.eq, s.n
  from (values
      (1, 'seasonal', 'Seasonal wheel change', 'job', 60000, 30, true, '{}'::text[]),
      (2, 'mounting', 'Tire mounting & balancing', 'wheel', 25000, 45, true, array['changer','balancer']),
      (3, 'balancing', 'Wheel balancing', 'wheel', 10000, 20, true, array['balancer']),
      (4, 'puncture', 'Puncture repair', 'job', 35000, 30, true, array['changer']),
      (5, 'valves', 'Valve replacement', 'wheel', 5000, 10, true, '{}'),
      (6, 'tpms', 'TPMS sensor service', 'wheel', 20000, 20, true, '{}'),
      (7, 'rims', 'Rim straightening', 'piece', 120000, 60, false, array['lift']),
      (8, 'washing', 'Wheel washing', 'wheel', 5000, 10, true, '{}'),
      (9, 'storage', 'Tire storage — one season', 'job', 150000, 5, true, '{}'),
      (10, 'extra', 'Nitrogen inflation', 'job', 10000, 5, true, '{}')) s(n, cat, name, unit, price, dur, online, eq);
  select array_agg(id order by sort_order) into svc from public.services where business_id = b;

  insert into public.pricing_rules (business_id, service_id, name, priority, rim_min, rim_max, adjustment, amount) values
    (b, svc[2], 'R17–R18', 10, 17, 18, 'add', 5000),
    (b, svc[2], 'R19–R22', 10, 19, 22, 'add', 12000),
    (b, svc[1], 'R19+', 10, 19, 26, 'add', 20000);
  insert into public.pricing_rules (business_id, service_id, name, priority, vehicle_category_id, adjustment, amount) values
    (b, null, 'SUV / 4x4 surcharge', 50, cat_suv, 'percent', 2000),
    (b, null, 'Van surcharge', 50, cat_van, 'percent', 3000);
  insert into public.pricing_rules (business_id, service_id, name, priority, runflat, adjustment, amount) values
    (b, svc[2], 'RunFlat', 20, true, 'add', 15000);
  insert into public.pricing_rules (business_id, service_id, name, priority, tpms, adjustment, amount) values
    (b, svc[1], 'TPMS check', 20, true, 'add', 10000);
  insert into public.duration_rules (business_id, service_id, name, priority, vehicle_category_id, adjustment, amount) values
    (b, null, 'SUV extra time', 50, cat_suv, 'add', 10),
    (b, null, 'Van extra time', 50, cat_van, 'add', 15);
  insert into public.duration_rules (business_id, service_id, name, priority, runflat, adjustment, amount) values
    (b, svc[2], 'RunFlat extra time', 20, true, 'add', 15);

  -- ── notification templates (transactional + marketing), en + cs
  insert into public.notification_templates (business_id, event, channel, locale, subject, body, is_marketing) values
    (b, 'booking_confirmed', 'sms', 'en', null, '{{business}}: booking confirmed {{date}} {{time}}, {{branch}}.', false),
    (b, 'booking_confirmed', 'sms', 'cs', null, '{{business}}: rezervace potvrzena {{date}} {{time}}, {{branch}}.', false),
    (b, 'booking_confirmed', 'email', 'en', 'Booking confirmed', 'Hello {{name}}, your booking on {{date}} at {{time}} ({{branch}}, {{address}}) is confirmed.', false),
    (b, 'booking_reminder_24h', 'sms', 'en', null, 'Reminder: tomorrow {{time}} at {{business}}, {{address}}.', false),
    (b, 'booking_reminder_24h', 'sms', 'cs', null, 'Připomínka: zítra {{time}} v {{business}}, {{address}}.', false),
    (b, 'booking_reminder_2h', 'sms', 'en', null, 'See you at {{time}} — {{business}}.', false),
    (b, 'booking_rescheduled', 'sms', 'en', null, '{{business}}: your booking moved to {{date}} {{time}}.', false),
    (b, 'booking_cancelled', 'sms', 'en', null, '{{business}}: your booking on {{date}} {{time}} was cancelled.', false),
    (b, 'order_ready', 'sms', 'en', null, '{{business}}: your car is ready. Order {{order}}, total {{total}}.', false),
    (b, 'storage_ending', 'sms', 'en', null, 'Your tire storage {{code}} ends on {{date}}. Book your change or extend storage.', false),
    (b, 'waitlist_offer', 'sms', 'en', null, 'A slot opened on {{date}}. Reply or book online to take it.', false),
    (b, 'seasonal_invite', 'sms', 'en', null, 'Winter is coming. Book your tire change early: {{link}}', true),
    (b, 'seasonal_invite', 'sms', 'cs', null, 'Blíží se zima. Objednejte se na přezutí včas: {{link}}', true);
  insert into public.notification_channels (business_id, channel, provider, is_enabled) values
    (b, 'sms', 'test', true), (b, 'email', 'test', true), (b, 'in_app', 'test', true);

  -- ── corporate customers (3)
  insert into public.corporate_customers (business_id, name, contact_name, contact_phone, discount_bp, payment_terms_days)
  select b, c.name, 'Fleet manager', '+420 600 100 ' || lpad((100 + c.disc / 10)::text, 3, '0'), c.disc, c.terms
  from (values ('Rychlá Doprava s.r.o.', 1000, 30), ('City Taxi Brno', 800, 14), ('Stavby Novák a.s.', 500, 30)) c(name, disc, terms);
  select array_agg(id order by name) into corp from public.corporate_customers where business_id = b;

  -- ── customers (100) + vehicles (130)
  cust := '{}'; veh := '{}';
  for i in 1..100 loop
    insert into public.customers (business_id, first_name, last_name, phone, email, locale, preferred_channel,
        source, is_vip, corporate_customer_id, created_at, discount_bp)
    values (b, first_names[1 + floor(random() * array_length(first_names, 1))::int],
               last_names[1 + floor(random() * array_length(last_names, 1))::int],
               '+420 7' || lpad((10000000 + i * 7919 % 89999999)::text, 8, '0'),
               case when random() < 0.6 then 'customer' || i || '@example.test' end,
               (array['cs','cs','cs','en','uk','pl','sk','de'])[1 + floor(random() * 8)::int]::public.app_locale,
               (array['sms','sms','email','whatsapp'])[1 + floor(random() * 4)::int],
               (array['manual','online','phone','walk_in'])[1 + floor(random() * 4)::int],
               random() < 0.08,
               case when i <= 9 then corp[1 + (i % 3)] end,
               now() - make_interval(days => floor(random() * 700)::int),
               case when random() < 0.1 then 500 else 0 end)
    returning id into v_c;
    cust := cust || v_c;
    insert into public.customer_consents (business_id, customer_id, kind, granted, source)
    values (b, v_c, 'data_processing', true, 'staff');
    if random() < 0.55 then
      insert into public.customer_consents (business_id, customer_id, kind, granted, source)
      values (b, v_c, 'marketing_sms', true, 'staff'), (b, v_c, 'marketing_email', true, 'staff');
    end if;
    for j in 1..(case when i <= 30 then 2 else 1 end) loop
      v_rim := (array[15,16,16,17,17,18,19,20])[1 + floor(random() * 8)::int];
      insert into public.vehicles (business_id, customer_id, category_id, make, model, year, plate, rim_diameter, tire_size,
          mileage_km, has_tpms, has_runflat, corporate_customer_id)
      values (b, v_c, case when random() < 0.7 then cat_car when random() < 0.7 then cat_suv else cat_van end,
              makes[1 + floor(random() * array_length(makes, 1))::int], models[1 + floor(random() * array_length(models, 1))::int],
              2008 + floor(random() * 17)::int,
              (1 + floor(random() * 9)::int)::text || chr(65 + floor(random() * 26)::int) || chr(65 + floor(random() * 26)::int)
                || ' ' || lpad(((i * 37 + j * 911) % 10000)::text, 4, '0'),
              v_rim, (array['195/65','205/55','225/45','235/55','245/40'])[1 + floor(random() * 5)::int] || ' R' || v_rim,
              20000 + floor(random() * 220000)::int, random() < 0.45, random() < 0.08,
              case when i <= 9 then corp[1 + (i % 3)] end)
      returning id into v_v;
      veh := veh || v_v;
    end loop;
  end loop;

  -- ── tags
  insert into public.tags (business_id, name, color) values (b, 'VIP', 'amber'), (b, 'Fleet', 'blue'), (b, 'Price sensitive', 'gray');
  insert into public.customer_tags (business_id, customer_id, tag_id)
  select b, c.id, (select id from public.tags where business_id = b and name = 'VIP') from public.customers c where c.business_id = b and c.is_vip;
  insert into public.customer_tags (business_id, customer_id, tag_id)
  select b, c.id, (select id from public.tags where business_id = b and name = 'Fleet') from public.customers c
   where c.business_id = b and c.corporate_customer_id is not null;

  -- ── inventory (40 products) with receipts
  insert into public.warehouses (business_id, branch_id, name, purpose) values (b, br1, 'Praha — stock', 'stock') returning id into wh_stock1;
  insert into public.warehouses (business_id, branch_id, name, purpose) values (b, br2, 'Brno — stock', 'stock') returning id into wh_stock2;
  insert into public.warehouses (business_id, branch_id, name, purpose) values (b, br1, 'Praha — tire hotel', 'tire_hotel') returning id into wh_hotel;
  insert into public.suppliers (business_id, name, phone) values (b, 'PneuGros CZ', '+420 222 333 444'), (b, 'Wheel Parts EU', '+49 30 1234567');

  prod := '{}';
  for i in 1..40 loop
    insert into public.products (business_id, sku, name, category, manufacturer, purchase_price, retail_price, min_stock, supplier_id, attributes)
    select b, 'SKU-' || lpad(i::text, 4, '0'),
      case when i <= 12 then (array['Michelin Alpin 6','Continental WinterContact','Nokian WR Snowproof','Bridgestone Blizzak','Goodyear UltraGrip','Hankook Winter i*cept'])[1 + (i % 6)]
                             || ' ' || (array['205/55 R16','225/45 R17','215/60 R16','235/55 R18'])[1 + (i % 4)]
           when i <= 16 then 'Used tire ' || (array['195/65 R15','205/55 R16','225/45 R17','215/60 R16'])[i - 12]
           when i <= 20 then 'Alloy rim ' || (15 + i - 16) || '"'
           when i <= 24 then (array['Rubber valve TR413','Metal valve TR525','Valve cap set','Valve core'])[i - 20]
           when i <= 27 then (array['TPMS sensor universal','TPMS sensor OEM VAG','TPMS service kit'])[i - 24]
           when i <= 31 then 'Balance weight ' || (array['5 g clip','10 g clip','5 g adhesive','50 g adhesive strip'])[i - 27]
           when i <= 34 then (array['Patch RP-30','Tire plug kit','Vulcanizing cement'])[i - 31]
           when i <= 36 then (array['Wheel bolt M14x1.5','Wheel bolt M12x1.5'])[i - 34]
           when i <= 38 then (array['Wheel nut M12x1.5','Locking nut set'])[i - 36]
           else (array['Bead lubricant 5 kg','Cleaning cloths'])[i - 38] end,
      case when i <= 12 then 'new_tires' when i <= 16 then 'used_tires' when i <= 20 then 'rims' when i <= 24 then 'valves'
           when i <= 27 then 'tpms_sensors' when i <= 31 then 'balance_weights' when i <= 34 then 'repair_materials'
           when i <= 36 then 'bolts' when i <= 38 then 'nuts' else 'consumables' end,
      case when i <= 12 then split_part((array['Michelin','Continental','Nokian','Bridgestone','Goodyear','Hankook'])[1 + (i % 6)], ' ', 1) end,
      p.cost, p.cost * 16 / 10, case when i <= 12 then 4 when i in (21, 25, 28, 32) then 20 else 2 end,
      (select id from public.suppliers where business_id = b order by name limit 1),
      '{}'::jsonb
    from (select case when i <= 12 then 180000 + i * 9000 when i <= 16 then 60000 when i <= 20 then 250000
                      when i <= 24 then 3000 + i * 100 when i <= 27 then 90000 when i <= 31 then 200
                      when i <= 34 then 4000 when i <= 38 then 2500 else 30000 end as cost) p
    returning id into v_v;
    prod := prod || v_v;
    insert into public.inventory_movements (business_id, product_id, warehouse_id, kind, quantity, unit_cost, note)
    select b, v_v, wh_stock1, 'receipt', case when i in (21, 28, 32) then 600 when i <= 12 then 8 + (i % 5) else 15 end,
           purchase_price, 'Opening stock' from public.products where id = v_v;
    if i % 3 = 0 then
      insert into public.inventory_movements (business_id, product_id, warehouse_id, kind, quantity, unit_cost, note)
      select b, v_v, wh_stock2, 'receipt', 6, purchase_price, 'Opening stock' from public.products where id = v_v;
    end if;
  end loop;
  -- make a few low on stock so the dashboard warns
  insert into public.inventory_movements (business_id, product_id, warehouse_id, kind, quantity, note)
  values (b, prod[3], wh_stock1, 'write_off', -(select on_hand - 1 from public.inventory_stock where product_id = prod[3] and warehouse_id = wh_stock1), 'Damaged'),
         (b, prod[26], wh_stock1, 'issue', -14, 'Sold over the counter');

  -- ── 200 historical work orders across 14 months (seasonal peaks in Mar–Apr and Oct–Nov)
  for i in 1..200 loop
    v_day := v_today - (case when random() < 0.6
                         then (array[30, 45, 60, 220, 235, 250, 395, 410])[1 + floor(random() * 8)::int] + floor(random() * 20)::int
                         else 1 + floor(random() * 420)::int end);
    k := 1 + floor(random() * array_length(veh, 1))::int;
    select customer_id into v_c from public.vehicles where id = veh[k];
    v_start := (v_day + time '08:00' + make_interval(mins => 30 * floor(random() * 18)::int)) at time zone 'Europe/Prague';
    insert into public.work_orders (business_id, number, branch_id, customer_id, vehicle_id, corporate_customer_id, workstation_id,
        employee_id, status, currency, vehicle_params, prices_include_tax, started_at, completed_at, created_at, order_discount_bp)
    select b, private.next_order_number(b), case when random() < 0.65 then br1 else br2 end, v_c, veh[k], c.corporate_customer_id,
           ws[1 + floor(random() * 5)::int], emp[1 + floor(random() * 6)::int],
           (case when i <= 194 then 'completed' else 'cancelled' end)::public.work_order_status, 'CZK',
           jsonb_build_object('vehicle_category_id', v.category_id, 'rim', v.rim_diameter, 'tpms', v.has_tpms, 'runflat', v.has_runflat, 'wheel_count', 4),
           true, v_start, v_start + make_interval(mins => 30 + floor(random() * 60)::int), v_start,
           coalesce((select discount_bp from public.corporate_customers where id = c.corporate_customer_id), c.discount_bp)
      from public.customers c, public.vehicles v where c.id = v_c and v.id = veh[k]
    returning id into v_o;

    insert into public.work_order_items (business_id, work_order_id, kind, service_id, name, quantity, unit_price, tax_rate_bp)
    select b, v_o, 'service', q.service_id, s.name, q.quantity, q.unit_price, q.tax_rate_bp
      from unnest(case floor(random() * 4)::int
                    when 0 then array[svc[1]] when 1 then array[svc[2], svc[5]]
                    when 2 then array[svc[1], svc[3], svc[8]] else array[svc[4]] end) sid
      cross join lateral public.quote_service(b, sid, (select vehicle_params from public.work_orders where id = v_o)) q
      join public.services s on s.id = sid;
    if random() < 0.3 then
      insert into public.work_order_items (business_id, work_order_id, kind, product_id, warehouse_id, name, quantity, unit_price, tax_rate_bp)
      select b, v_o, 'product', p.id, wh_stock1, p.name, 4, p.retail_price, 2100 from public.products p where p.id = prod[21];
    end if;
    perform private.recalc_work_order(v_o);

    if i <= 194 then
      update public.customers set visits_count = visits_count + 1,
             total_spent = total_spent + (select total from public.work_orders where id = v_o),
             last_visit_at = greatest(last_visit_at, v_start)
       where id = v_c;
      -- 185 paid in full, 6 partial, 3 unpaid
      if i <= 185 then
        insert into public.payments (business_id, work_order_id, customer_id, kind, amount, currency, method_id, received_at)
        select b, v_o, v_c, 'payment', total, 'CZK',
               case when corporate_customer_id is not null then m_transfer when random() < 0.55 then m_card else m_cash end,
               completed_at from public.work_orders where id = v_o and total > 0;
      elsif i <= 191 then
        insert into public.payments (business_id, work_order_id, customer_id, kind, amount, currency, method_id, received_at)
        select b, v_o, v_c, 'payment', total / 2, 'CZK', m_cash, completed_at from public.work_orders where id = v_o and total > 1;
      end if;
      perform private.refresh_payment_status(v_o);
      insert into public.inventory_movements (business_id, product_id, warehouse_id, kind, quantity, work_order_id, created_at)
      select b, product_id, warehouse_id, 'order_consumption', -quantity, v_o, v_start
        from public.work_order_items where work_order_id = v_o and kind = 'product';
    end if;
  end loop;
  -- one refund example
  insert into public.payments (business_id, work_order_id, customer_id, kind, amount, currency, method_id, refund_of, note, received_at)
  select b, p.work_order_id, p.customer_id, 'refund', least(p.amount, 20000), 'CZK', p.method_id, p.id, 'Goodwill: balancing redone', p.received_at + interval '2 days'
    from public.payments p where p.business_id = b and p.kind = 'payment' order by p.received_at desc limit 1;
  perform private.refresh_payment_status(work_order_id) from public.payments where business_id = b and kind = 'refund';

  -- ── 3 orders currently in the workshop
  for i in 1..3 loop
    insert into public.work_orders (business_id, number, branch_id, customer_id, vehicle_id, workstation_id, employee_id, status,
        currency, vehicle_params, prices_include_tax, started_at)
    select b, private.next_order_number(b), br1, v.customer_id, v.id, ws[i], emp[i],
           (array['in_progress', 'awaiting_approval', 'ready'])[i]::public.work_order_status, 'CZK',
           jsonb_build_object('vehicle_category_id', v.category_id, 'rim', v.rim_diameter, 'wheel_count', 4), true, now() - interval '40 minutes'
      from public.vehicles v where v.id = veh[10 + i]
    returning id into v_o;
    insert into public.work_order_items (business_id, work_order_id, kind, service_id, name, quantity, unit_price, tax_rate_bp, approval, is_additional)
    select b, v_o, 'service', q.service_id, s.name, q.quantity, q.unit_price, q.tax_rate_bp,
           case when i = 2 and sid = svc[6] then 'pending' else 'approved' end, sid = svc[6]
      from unnest(case when i = 2 then array[svc[1], svc[6]] else array[svc[2]] end) sid
      cross join lateral public.quote_service(b, sid, (select vehicle_params from public.work_orders where id = v_o)) q
      join public.services s on s.id = sid;
    perform private.recalc_work_order(v_o);
  end loop;

  -- ── upcoming bookings for the next 7 days (non-overlapping by construction)
  for v_day in select g::date from generate_series(v_today, v_today + 6, interval '1 day') g loop
    continue when extract(isodow from v_day) = 7;
    for k in 1..5 loop
      for j in 8..16 loop
        continue when random() < 0.45;
        continue when extract(isodow from v_day) = 6 and (j < 9 or j > 13);
        i := 1 + floor(random() * array_length(veh, 1))::int;
        v_start := (v_day + make_time(j, 0, 0)) at time zone 'Europe/Prague';
        continue when v_start < now();
        insert into public.bookings (business_id, branch_id, customer_id, vehicle_id, workstation_id, employee_id, status,
            starts_at, ends_at, source, vehicle_params, quoted_total, plate_text)
        select b, w.branch_id, v.customer_id, v.id, w.id,
               case when k <= 3 then emp[k] else emp[k + 1] end,
               (case when random() < 0.15 then 'pending' else 'confirmed' end)::public.booking_status,
               v_start, v_start + interval '45 minutes',
               (array['staff','online','online','phone'])[1 + floor(random() * 4)::int],
               jsonb_build_object('vehicle_category_id', v.category_id, 'rim', v.rim_diameter, 'wheel_count', 4),
               (public.quote_service(b, svc[1], jsonb_build_object('rim', v.rim_diameter))).line_total, v.plate
          from public.workstations w, public.vehicles v where w.id = ws[k] and v.id = veh[i]
        returning id into v_o;
        insert into public.booking_services (business_id, booking_id, service_id, quantity, unit_price, duration_min)
        select b, v_o, svc[1], 1, unit_price, 45 from public.bookings bk, lateral (select (public.quote_service(b, svc[1], bk.vehicle_params)).unit_price) q
         where bk.id = v_o;
      end loop;
    end loop;
  end loop;
  insert into public.waiting_list (business_id, branch_id, customer_id, service_ids, earliest, latest)
  values (b, br1, cust[5], array[svc[1]], v_today, v_today + 5), (b, br1, cust[6], array[svc[2]], v_today + 1, v_today + 7);

  -- ── tire hotel: 2 zones × 6 racks × 4 shelves × 4 cells = 192 cells, 60 sets stored
  insert into public.storage_locations (business_id, warehouse_id, zone, rack, shelf, cell, capacity_sets)
  select b, wh_hotel, z, r, s, c, 1 from unnest(array['A', 'B']) z, generate_series(1, 6) r, generate_series(1, 4) s, generate_series(1, 4) c;

  for i in 1..60 loop
    select id into v_loc from public.storage_locations where warehouse_id = wh_hotel and occupied_sets < capacity_sets
     order by zone, rack, shelf, cell limit 1;
    select id, customer_id, rim_diameter into v_v, v_c, v_rim from public.vehicles where id = veh[i * 2];
    insert into public.tire_sets (business_id, code, customer_id, vehicle_id, quantity, manufacturer, model, season, width, profile,
        diameter, load_index, speed_index, with_rims, rim_type, condition, location_id, created_at)
    values (b, 'TS-' || lpad(to_hex(4096 + i * 97), 6, '0'), v_c, v_v, 4,
            (array['Michelin','Continental','Nokian','Bridgestone','Goodyear'])[1 + (i % 5)],
            (array['Primacy 4','PremiumContact 6','Wetproof','Turanza','EfficientGrip'])[1 + (i % 5)],
            case when i % 4 = 0 then 'winter' else 'summer' end, (array[195,205,225,235])[1 + (i % 4)], (array[65,55,45,55])[1 + (i % 4)],
            coalesce(v_rim, 16), '91', 'V', i % 3 = 0, case when i % 3 = 0 then 'alloy' end,
            (array['good','good','fair','worn'])[1 + (i % 4)], v_loc, now() - interval '40 days')
    returning id into v_set;
    insert into public.tire_set_items (business_id, tire_set_id, position, dot, tread_mm)
    select b, v_set, p, lpad(((i % 52) + 1)::text, 2, '0') || (20 + i % 5)::text, round((3 + random() * 4)::numeric, 1)
      from unnest(array['FL','FR','RL','RR']) p;
    insert into public.tire_storage_movements (business_id, tire_set_id, kind, to_location_id, created_at)
    values (b, v_set, 'check_in', v_loc, now() - interval '40 days');
    insert into public.tire_storage_contracts (business_id, tire_set_id, number, starts_on, ends_on, price, currency, paid_total)
    values (b, v_set, 'SC-' || lpad(to_hex(8192 + i * 89), 6, '0'), v_today - 40,
            case when i <= 6 then v_today + i * 3 else v_today + 140 end, 150000, 'CZK',
            case when i % 7 = 0 then 0 else 150000 end)
    returning id into v_contract;
    if i % 7 <> 0 then
      insert into public.payments (business_id, storage_contract_id, customer_id, kind, amount, currency, method_id, received_at)
      values (b, v_contract, v_c, 'payment', 150000, 'CZK', m_card, now() - interval '40 days');
    end if;
  end loop;

  -- ── expenses for 14 months
  insert into public.expenses (business_id, branch_id, category, amount, currency, spent_on, note)
  select b, br, cat, amt, 'CZK', (date_trunc('month', v_today) - make_interval(months => m))::date + 4, cat || ' ' || to_char(date_trunc('month', v_today) - make_interval(months => m), 'YYYY-MM')
    from generate_series(0, 13) m,
         (values (br1, 'rent', 4500000), (br2, 'rent', 3200000), (br1, 'salaries', 18000000), (br2, 'salaries', 12000000),
                 (br1, 'utilities', 650000), (null::uuid, 'marketing', 300000)) e(br, cat, amt);

  -- ── second, unrelated tenant for isolation tests
  insert into public.businesses (id, slug, name, license_kind) values (b2, 'other-tires', 'Other Tires GmbH', 'trial');
  perform private.bootstrap_business(b2, 'de', 'EUR');
  insert into public.branches (business_id, name, city, country) values (b2, 'Wien', 'Wien', 'AT') returning id into br_other;
  insert into public.memberships (business_id, user_id, role) values (b2, u_other, 'owner');
  insert into public.workstations (business_id, branch_id, name) values (b2, br_other, 'Platz 1');
  insert into public.customers (business_id, first_name, last_name, phone) values (b2, 'Secret', 'Customer', '+43 660 1234567');
end $seed$;
