# Копія Green Touch за ~6 хвилин (локально)

Шість хвилин — це лише запуск коду на вашому компʼютері з тестовими адаптерами. Акаунти LiqPay, Нової пошти, Supabase і Vercel оформлюються окремо й довше (див. SETUP.md).

## Передумови (мають бути вже встановлені)
- Node 22+ і `corepack enable` (pnpm 12)
- Docker Desktop запущений
- Вільні порти 55420–55429, 55480–55481, 4180

## Кроки

```bash
cd green-touch
pnpm install
pnpm db:start
```

```bash
cp .env.example .env.local
```
Вставте у `.env.local` значення `ANON_KEY` з `npx supabase status` як `VITE_SUPABASE_ANON_KEY`.

```bash
cp supabase/functions/.env.example supabase/functions/.env
```
Заповніть у ньому блок «тестові адаптери» з SETUP.md (розділ 1).

Три термінали:

```bash
pnpm fakes
```
```bash
pnpm functions:serve
```
```bash
pnpm build && pnpm preview
```

Відкрийте http://localhost:4180 — каталог із 22 товарами. Оплата відкриє сторінку **тестового адаптера LiqPay** (кнопка «Оплатити (тест)»), це не справжній LiqPay.

Адміністратор:

```bash
SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY зі status> pnpm admin:create you@example.com
```
Пароль — у `.secrets/admin.local.txt`, вхід на `/admin`.

Перевірка, що все живе:

```bash
pnpm test && pnpm test:db && pnpm test:e2e
```
