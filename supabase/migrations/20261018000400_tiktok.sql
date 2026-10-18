-- TikTok profile on the studio page; Facebook may be a full page URL
-- (pages without a username live at facebook.com/p/<name>-<id>).

alter table public.tenants add column tiktok text check (tiktok is null or char_length(tiktok) <= 64);
alter table public.tenants drop constraint tenants_facebook_check;
alter table public.tenants add constraint tenants_facebook_check check (facebook is null or char_length(facebook) <= 200);

create or replace function public.public_get_tenant(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  return jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'status', t.status,
    'kind', t.kind,
    'name', t.name,
    'short_name', t.short_name,
    'tagline', t.tagline,
    'description', t.description,
    'timezone', t.timezone,
    'currency', t.currency,
    'locale', t.locale,
    'accent_color', t.accent_color,
    'phone', t.phone,
    'address', t.address,
    'legal_address', t.legal_address,
    'map_url', t.map_url,
    'lat', t.lat,
    'lng', t.lng,
    'telegram', t.telegram,
    'whatsapp', t.whatsapp,
    'instagram', t.instagram,
    'facebook', t.facebook,
    'tiktok', t.tiktok,
    'email', t.email,
    'logo_path', t.logo_path,
    'hero_path', t.hero_path,
    'assistant_enabled', t.assistant_enabled,
    'faq', t.faq,
    'booking', jsonb_build_object(
      'slot_step_minutes', t.slot_step_minutes,
      'min_lead_minutes', t.min_lead_minutes,
      'horizon_days', t.horizon_days,
      'cancel_cutoff_hours', t.cancel_cutoff_hours,
      'default_buffer_minutes', t.default_buffer_minutes
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'key', s.key, 'name', s.name, 'description', s.description,
        'category', s.category, 'price', s.price, 'price_from', s.price_from,
        'duration_minutes', s.duration_minutes) order by s.sort, s.name)
      from public.services s
      where s.tenant_id = t.id and s.is_active
        and exists (select 1 from private.eligible_resources(s.id))
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'opens', to_char(w.opens, 'HH24:MI'),
                                          'closes', to_char(w.closes, 'HH24:MI')) order by w.weekday, w.opens)
      from public.working_hours w where w.tenant_id = t.id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object('day', e.day, 'is_closed', e.is_closed,
                                          'opens', to_char(e.opens, 'HH24:MI'), 'closes', to_char(e.closes, 'HH24:MI'),
                                          'note', e.note) order by e.day)
      from public.schedule_exceptions e
      where e.tenant_id = t.id and e.day >= (now() at time zone t.timezone)::date
        and e.day < (now() at time zone t.timezone)::date + 60
    ), '[]'::jsonb),
    'info_cards', coalesce((
      select jsonb_agg(jsonb_build_object('position', c.position, 'icon', c.icon, 'title', c.title, 'text', c.text)
                       order by c.position)
      from public.info_cards c where c.tenant_id = t.id
    ), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'image_path', g.image_path, 'before_path', g.before_path,
                                          'caption', g.caption,
                                          'updated_at', g.updated_at) order by g.sort, g.created_at)
      from public.gallery_items g where g.tenant_id = t.id
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.owner_update_tenant(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  k text;
  allowed text[] := array['name', 'short_name', 'tagline', 'description', 'phone', 'address', 'legal_address', 'map_url',
                          'telegram', 'whatsapp', 'instagram', 'facebook', 'tiktok', 'email', 'logo_path', 'hero_path', 'accent_color',
                          'slot_step_minutes', 'min_lead_minutes', 'horizon_days', 'cancel_cutoff_hours',
                          'default_buffer_minutes', 'assistant_enabled'];
begin
  perform private.require_member(p_tenant_id);
  for k in select jsonb_object_keys(p_patch) loop
    if not k = any(allowed) then
      perform private.fail('422', 'FIELD_NOT_EDITABLE', format('Поле %s нельзя менять', k));
    end if;
  end loop;
  if p_patch ? 'phone' then
    p_patch := jsonb_set(p_patch, '{phone}', to_jsonb(private.normalize_phone(p_patch ->> 'phone')));
  end if;
  update public.tenants t set
    name = coalesce(p_patch ->> 'name', t.name),
    short_name = case when p_patch ? 'short_name' then nullif(p_patch ->> 'short_name', '') else t.short_name end,
    tagline = coalesce(p_patch ->> 'tagline', t.tagline),
    description = coalesce(p_patch ->> 'description', t.description),
    phone = coalesce(p_patch ->> 'phone', t.phone),
    address = coalesce(p_patch ->> 'address', t.address),
    legal_address = case when p_patch ? 'legal_address' then nullif(p_patch ->> 'legal_address', '') else t.legal_address end,
    map_url = case when p_patch ? 'map_url' then nullif(p_patch ->> 'map_url', '') else t.map_url end,
    telegram = case when p_patch ? 'telegram' then nullif(p_patch ->> 'telegram', '') else t.telegram end,
    whatsapp = case when p_patch ? 'whatsapp' then nullif(p_patch ->> 'whatsapp', '') else t.whatsapp end,
    instagram = case when p_patch ? 'instagram' then nullif(p_patch ->> 'instagram', '') else t.instagram end,
    facebook = case when p_patch ? 'facebook' then nullif(p_patch ->> 'facebook', '') else t.facebook end,
    tiktok = case when p_patch ? 'tiktok' then nullif(p_patch ->> 'tiktok', '') else t.tiktok end,
    email = case when p_patch ? 'email' then nullif(p_patch ->> 'email', '') else t.email end,
    logo_path = coalesce(p_patch ->> 'logo_path', t.logo_path),
    hero_path = coalesce(p_patch ->> 'hero_path', t.hero_path),
    accent_color = coalesce(p_patch ->> 'accent_color', t.accent_color),
    slot_step_minutes = coalesce((p_patch ->> 'slot_step_minutes')::int, t.slot_step_minutes),
    min_lead_minutes = coalesce((p_patch ->> 'min_lead_minutes')::int, t.min_lead_minutes),
    horizon_days = coalesce((p_patch ->> 'horizon_days')::int, t.horizon_days),
    cancel_cutoff_hours = coalesce((p_patch ->> 'cancel_cutoff_hours')::int, t.cancel_cutoff_hours),
    default_buffer_minutes = coalesce((p_patch ->> 'default_buffer_minutes')::int, t.default_buffer_minutes),
    assistant_enabled = coalesce((p_patch ->> 'assistant_enabled')::boolean, t.assistant_enabled),
    owner_edited_at = now()
  where t.id = p_tenant_id;
  return public.public_get_tenant((select slug from public.tenants where id = p_tenant_id));
exception
  when check_violation then
    perform private.fail('422', 'INVALID_VALUE', 'Проверьте значения: одно из полей заполнено неверно');
    return null;
end $$;

create or replace function public.svc_sync_tenant(p_config jsonb, p_config_hash text, p_sync_content boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := private.sync_tenant_core(p_config, p_config_hash, p_sync_content);
  v_tenant uuid := (r ->> 'tenant_id')::uuid;
begin
  if (r ->> 'content_synced')::boolean then
    update public.tenants
       set legal_address = nullif(p_config -> 'contacts' ->> 'legalAddress', ''),
           instagram = nullif(p_config -> 'contacts' ->> 'instagram', ''),
           facebook = nullif(p_config -> 'contacts' ->> 'facebook', ''),
           tiktok = nullif(p_config -> 'contacts' ->> 'tiktok', ''),
           faq = coalesce(p_config -> 'faq', '[]'::jsonb)
     where id = v_tenant;
    update public.gallery_items g
       set before_path = nullif(x ->> 'before', '')
      from jsonb_array_elements(coalesce(p_config -> 'gallery', '[]'::jsonb)) x
     where g.tenant_id = v_tenant and g.source = 'config' and g.config_key = x ->> 'image'
       and g.before_path is distinct from nullif(x ->> 'before', '');
    -- Closed dates from the config are labelled in the studio language.
    if p_config ->> 'locale' = 'cs-CZ' then
      update public.schedule_exceptions set note = 'Zavřeno'
       where tenant_id = v_tenant and source = 'config' and note = 'Выходной';
    end if;
  end if;
  return r;
end $$;
