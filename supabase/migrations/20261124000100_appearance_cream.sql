-- Studio appearance "cream": a light theme on a warm milky canvas with
-- graphite text, for beauty studios whose aesthetic is soft rather than
-- stark white. Same wiring as "light"; only the palette differs.

alter table public.tenants drop constraint if exists tenants_appearance_check;
alter table public.tenants
  add constraint tenants_appearance_check check (appearance in ('light', 'dark', 'cream'));

create or replace function private.sync_tenant_appearance(p_config jsonb, p_config_hash text, p_sync_content boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := private.sync_tenant_beauty(p_config, p_config_hash, p_sync_content);
begin
  if (r ->> 'content_synced')::boolean then
    update public.tenants
       set appearance = case when p_config ->> 'appearance' in ('light', 'dark', 'cream') then p_config ->> 'appearance' end
     where id = (r ->> 'tenant_id')::uuid;
  end if;
  return r;
end $$;

revoke execute on function private.sync_tenant_appearance(jsonb, text, boolean) from public, anon, authenticated;
