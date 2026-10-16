# Онлайн-запись в автосервис и детейлинг

Одно PWA на много студий: у каждой своя ссылка `/s/<slug>/`, иконка, манифест и кабинет владельца
`/s/<slug>/owner/`. Клиент записывается без регистрации; занятость боксов, атомарная запись, права
доступа и статистика — на стороне PostgreSQL (Supabase).

- **Новая студия:** [CLONE-IN-6-MINUTES.md](CLONE-IN-6-MINUTES.md)
- **Установка и публикация:** [SETUP.md](SETUP.md)
- **Что проверено:** [ACCEPTANCE.md](ACCEPTANCE.md)
- **Этапы и решения:** [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)

Структура: `src/` — приложение (React 19, Astryx, TanStack Query), `src/sw.ts` — service worker,
`supabase/migrations` — схема и SQL-функции, `supabase/functions` — помощники и диспетчер напоминаний,
`tenants/` — настройки студий, `scripts/` — конвейер, `tests/` — unit, db, e2e.
