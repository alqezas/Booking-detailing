-- Frequently asked questions of a studio: [{question, answer, keywords[]}].
-- Shown on the home page and used by the assistant (prompt and fallback).

alter table public.tenants add column faq jsonb not null default '[]'::jsonb
  check (jsonb_typeof(faq) = 'array' and jsonb_array_length(faq) <= 20);

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
