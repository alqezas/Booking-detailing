-- Studio appearance: beauty studios are light by default; a barbershop (or any
-- beauty-kind studio) can ask for the dark theme with "appearance": "dark" in
-- business.json. Car studios are always dark and ignore it.
--
-- The existing functions are wrapped, not copied: the previous versions move to
-- the private schema under new names and the public ones add one field.

alter table public.tenants
  add column if not exists appearance text check (appearance in ('light', 'dark'));

-- Read model: public_get_tenant + appearance -------------------------------
alter function public.public_get_tenant(text) rename to public_get_tenant_v6;
alter function public.public_get_tenant_v6(text) set schema private;

create or replace function public.public_get_tenant(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  return private.public_get_tenant_v6(p_slug) || jsonb_build_object('appearance', t.appearance);
end $$;

grant execute on function public.public_get_tenant(text) to anon, authenticated;

-- Pipeline: svc_sync_tenant also stores the appearance ----------------------
alter function public.svc_sync_tenant(jsonb, text, boolean) rename to sync_tenant_beauty;
alter function public.sync_tenant_beauty(jsonb, text, boolean) set schema private;
revoke execute on function private.sync_tenant_beauty(jsonb, text, boolean) from public, anon, authenticated;

create or replace function public.svc_sync_tenant(p_config jsonb, p_config_hash text, p_sync_content boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := private.sync_tenant_beauty(p_config, p_config_hash, p_sync_content);
begin
  if (r ->> 'content_synced')::boolean then
    update public.tenants
       set appearance = case when p_config ->> 'appearance' in ('light', 'dark') then p_config ->> 'appearance' end
     where id = (r ->> 'tenant_id')::uuid;
  end if;
  return r;
end $$;

revoke execute on function public.svc_sync_tenant(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.svc_sync_tenant(jsonb, text, boolean) to service_role;
