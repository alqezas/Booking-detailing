-- The owner can delete a product, sample or kit from the admin.
-- Past orders keep their snapshots (order_lines.item_id is set null).
-- A product that is part of a kit cannot be deleted until it is removed from that kit.
-- Deleted seed items are remembered so re-running seed.sql does not bring them back.

create table private.deleted_seed_keys (
  seed_key text primary key,
  deleted_at timestamptz not null default now()
);

create function public.admin_delete_item(p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.items;
  v_kits text;
  v_paths text[];
begin
  perform private.assert_admin();
  select * into v from public.items where id = p_item for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  select string_agg(k.name, ', ' order by k.name) into v_kits
  from public.kit_components kc join public.items k on k.id = kc.kit_id
  where kc.product_id = p_item;
  if v_kits is not null then
    raise exception 'ITEM_IN_KIT' using hint = v_kits;
  end if;

  select coalesce(array_agg(path), '{}') into v_paths from public.item_images where item_id = p_item;
  if v.seed_key is not null then
    insert into private.deleted_seed_keys (seed_key) values (v.seed_key) on conflict do nothing;
  end if;
  -- facets, images rows, kit components (for a kit) and home picks cascade
  delete from public.items where id = p_item;
  -- storage files are removed by the admin client (it has write access to the bucket)
  return jsonb_build_object('ok', true, 'image_paths', to_jsonb(v_paths));
end $$;
revoke execute on function public.admin_delete_item(uuid) from public, anon;
grant execute on function public.admin_delete_item(uuid) to authenticated;
