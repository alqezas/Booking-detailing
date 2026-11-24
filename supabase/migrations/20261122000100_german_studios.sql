-- German-speaking studios (Austria first): the studio language may be de-AT.
alter table public.tenants drop constraint tenants_locale_check;
alter table public.tenants add constraint tenants_locale_check check (locale in ('ru-RU', 'cs-CZ', 'pl-PL', 'uk-UA', 'de-AT'));
