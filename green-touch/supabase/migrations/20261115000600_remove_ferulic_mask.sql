-- Owner decision (15.11.2026): «Маска з феруловою кислотою та рожевою глиною» is no longer sold.
-- Past orders keep their snapshot (order_lines.item_id is set null). It is not part of any kit.
insert into private.deleted_seed_keys (seed_key) values ('gt-22') on conflict do nothing;
delete from public.items where seed_key = 'gt-22' and kind = 'product';
