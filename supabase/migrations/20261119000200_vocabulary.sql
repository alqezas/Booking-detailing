-- Studio vocabulary: beauty-kind barbershops ("vocabulary": "barber" in
-- business.json) get «barber / barbershop» instead of «master / studio» in
-- the interface. Wraps the functions from 20261119000100_appearance.sql.

alter table public.tenants
  add column if not exists vocabulary text check (vocabulary in ('barber'));

alter function public.public_get_tenant(text) rename to public_get_tenant_v7;
alter function public.public_get_tenant_v7(text) set schema private;

create or replace function public.public_get_tenant(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  t := private.tenant_by_slug(p_slug);
  return private.public_get_tenant_v7(p_slug) || jsonb_build_object('vocabulary', t.vocabulary);
end $$;

grant execute on function public.public_get_tenant(text) to anon, authenticated;

alter function public.svc_sync_tenant(jsonb, text, boolean) rename to sync_tenant_appearance;
alter function public.sync_tenant_appearance(jsonb, text, boolean) set schema private;
revoke execute on function private.sync_tenant_appearance(jsonb, text, boolean) from public, anon, authenticated;

create or replace function public.svc_sync_tenant(p_config jsonb, p_config_hash text, p_sync_content boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := private.sync_tenant_appearance(p_config, p_config_hash, p_sync_content);
begin
  if (r ->> 'content_synced')::boolean then
    update public.tenants
       set vocabulary = case when p_config ->> 'vocabulary' = 'barber' then 'barber' end
     where id = (r ->> 'tenant_id')::uuid;
  end if;
  return r;
end $$;

revoke execute on function public.svc_sync_tenant(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.svc_sync_tenant(jsonb, text, boolean) to service_role;
