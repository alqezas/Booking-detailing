# Green Touch — налаштування та публікація

Магазин косметики «під замовлення»: React 19 + Vite (статичний фронтенд на Vercel), Supabase (Postgres, Auth, Storage, Edge Functions), оплата LiqPay, доставка Новою поштою.

## Архітектура коротко

| Частина | Де | Що робить |
|---|---|---|
| Фронтенд | `src/` → `dist/` (Vercel) | вітрина, кошик (localStorage), оформлення, статус замовлення, адмінка `/admin`, PWA |
| База | `supabase/migrations/` | каталог і набори, фільтри, замовлення зі знімками цін, платежі, outbox, RLS |
| Seed | `supabase/seed.sql` | 22 товари, налаштування, тексти сторінок (повторно запускається без дублів) |
| Edge Functions | `supabase/functions/` | `checkout`, `order`, `np` (Нова пошта), `liqpay-callback`, `jobs` (cron) |
| Тести | `tests/unit`, `tests/db`, `tests/e2e` | Vitest, SQL/інтеграційні, Playwright |

Гроші — цілі копійки. Час — UTC у базі, відображення Europe/Kyiv. Усе виготовляється під замовлення: залишків і резервів немає, у товару є лише перемикач «Приймаємо замовлення».

## 1. Локальний запуск

Потрібно: Node 22+, pnpm 12 (`corepack enable`), Docker Desktop.

```bash
pnpm install
pnpm db:start            # локальний Supabase (порти 554xx, не конфліктують з іншими проєктами)
cp .env.example .env.local          # VITE_SUPABASE_ANON_KEY = ANON_KEY з `npx supabase status`
cp supabase/functions/.env.example supabase/functions/.env
```

Для локальної роботи без справжніх ключів у `supabase/functions/.env` вкажіть тестові адаптери (вони імітують LiqPay і Нову пошту, це НЕ справжні сервіси):

```
LIQPAY_PUBLIC_KEY=sandbox_test_public
LIQPAY_PRIVATE_KEY=sandbox_test_private
LIQPAY_API_URL=http://host.docker.internal:55480
LIQPAY_CHECKOUT_URL=http://127.0.0.1:55480/api/3/checkout
LIQPAY_SANDBOX=1
LIQPAY_CALLBACK_URL=http://127.0.0.1:55421/functions/v1/liqpay-callback
NP_API_URL=http://host.docker.internal:55481/v2.0/json/
ORDER_TOKEN_SECRET=<openssl rand -base64 32>
JOBS_SECRET=<openssl rand -base64 32>
SITE_URL=http://localhost:4180
```

Потім у трьох терміналах:

```bash
pnpm fakes               # тестові адаптери LiqPay (55480) і Нової пошти (55481)
pnpm functions:serve     # Edge Functions
pnpm build && pnpm preview   # http://localhost:4180
```

Перевірки:

```bash
pnpm typecheck && pnpm test      # типи + unit
pnpm test:db                     # SQL/інтеграційні (потрібен pnpm db:start)
pnpm test:e2e                    # Playwright (потрібні fakes і functions:serve)
```

## 2. Supabase у хмарі

1. Створіть проєкт на supabase.com (регіон — ближче до України, напр. Frankfurt).
2. Привʼяжіть і застосуйте міграції:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
3. Seed (22 товари, налаштування, сторінки). Скрипт повторно запускається і не перезаписує правки власниці:
   ```bash
   psql "<connection string з Settings → Database>" -f supabase/seed.sql
   ```
4. Auth → Providers: Email увімкнено, **Sign-ups вимкнено** (у `supabase/config.toml` `enable_signup = false` діє локально; у хмарі вимкніть у дашборді). Site URL = адреса сайту.
5. Storage: бакет `catalog` створює міграція (публічне читання, запис лише адміністраторам, JPEG/PNG/WebP/AVIF до 5 МБ).

## 3. Secrets Edge Functions

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` платформа додає сама. Решту:

```bash
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy checkout order liqpay-callback np jobs
```

| Secret | Значення |
|---|---|
| `SITE_URL` | `https://<ваш домен>` (сюди LiqPay повертає покупця) |
| `ALLOWED_ORIGINS` | той самий домен (CORS) |
| `ORDER_TOKEN_SECRET` | випадковий рядок (гостьові посилання на замовлення) |
| `JOBS_SECRET` | випадковий рядок (той самий — у Vault, див. cron) |
| `LIQPAY_PUBLIC_KEY`, `LIQPAY_PRIVATE_KEY` | ключі магазину з кабінету LiqPay → API |
| `LIQPAY_SANDBOX` | `1` для тестових платежів, порожньо — бойові |
| `LIQPAY_SIGNATURE_ALGO` | `sha3-256` (поточна документація) або `sha1` (старі кабінети) |
| `PAYMENT_VALIDITY_MINUTES` | скільки діє посилання на оплату (за замовчуванням 1440 = 24 год) |
| `NP_API_KEY` | ключ API Нової пошти (кабінет → Налаштування → Безпека) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | необовʼязково: сповіщення про оплачені замовлення |

Функція `liqpay-callback` працює без JWT (так налаштовано в `config.toml`), її захищає перевірка підпису LiqPay. Решта функцій вимагають anon-ключ.

## 4. LiqPay

1. У кабінеті LiqPay створіть магазин, візьміть public/private key.
2. URL для callback (server_url) магазин передає сам у кожному платежі: `https://<ref>.supabase.co/functions/v1/liqpay-callback`.
3. Перший прогін — з `LIQPAY_SANDBOX=1`: тестова оплата отримає статус `sandbox`, і лише в цьому режимі вважається оплаченою.
4. Після перевірки приберіть `LIQPAY_SANDBOX` і перевірте одну справжню оплату на невелику суму.

Як працює: сервер рахує суму з бази, підписує форму (`data` + `signature`), браузер відправляє її на сторінку LiqPay. Повернення покупця на сайт оплату не підтверджує: статус змінює лише callback з правильним підписом або запит статусу (`action=status`). Кожна спроба оплати має власний `order_id` (LiqPay вимагає унікальності).

## 5. Нова пошта

Ключ API потрібен для стабільної роботи (деякі методи відповідають і без ключа, але покладатися на це не варто). Ключ живе лише в Edge Function `np` — у браузер не потрапляє.

## 6. Cron (фонові задачі)

Міграція вже планує `gt-wake-jobs` щохвилини (pg_cron → pg_net → функція `jobs`): звірка зависших платежів із LiqPay та доставка outbox. Додайте у Vault два секрети (SQL Editor):

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/jobs', 'gt_jobs_url');
select vault.create_secret('<той самий JOBS_SECRET>', 'gt_jobs_secret');
```

Поки секретів немає, задачі нічого не роблять і події outbox чекають (не губляться). Розклад: `select * from cron.job;`.

## 7. Перший адміністратор

Публічної реєстрації адміністраторів немає.

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> pnpm admin:create owner@example.com
```

Пароль записується у `.secrets/admin.local.txt` (у git не потрапляє). Вхід — `/admin`. Розділ «Перед запуском» показує, чого ще бракує (фото, характеристики, тексти, контакти).

## 8. Публікація на Vercel

1. New Project → імпорт репозиторію, **Root Directory = `green-touch`**.
2. Environment Variables (лише публічні): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`.
3. Build: `pnpm build` (є у `vercel.json`), output `dist`. Rewrite на `index.html` для React Router; prerender-файли (`tovar/<slug>.html`) Vercel віддає завдяки `cleanUrls`.
4. Збирайте на бойовій базі: prerender бере назви й ціни з каталогу на момент збірки. Після зміни цін — перевидеплойте, щоб оновились метадані для пошуковиків.

Cloudflare Pages: той самий `dist`, файл `public/_redirects` вже є.

## SEO та обмеження

- Prerender записує для кожної сторінки свій `<title>`, description, canonical, Open Graph і `Product` structured data (реальна ціна, без рейтингів). Тіло сторінки рендериться в браузері.
- `sitemap.xml` і `robots.txt` генеруються при збірці (якщо задано `VITE_SITE_URL`).

## PWA та офлайн

Service worker (Workbox, injectManifest) кешує оболонку, публічний каталог (обмежено) і фото. Не кешуються: авторизація, функції (оформлення, оплата, статус), адмінка. Без мережі можна переглядати збережене й змінювати кошик; оформлення й оплата заблоковані, нічого не ставиться в чергу.

## Рішення щодо стеку

- **shadcn/ui не підключено.** У репозиторії діє правило AGENTS.md «без Tailwind-компілятора й утилітарних класів», а документація Astryx радить заміняти примітиви shadcn компонентами Astryx. Шторка — Astryx `BottomSheet`.
- **SHA3 для LiqPay** — `@noble/hashes` (у Web Crypto немає SHA3), однаково працює в Deno і Node.
- **liquid-gl** — лише на плаваючій панелі кошика; при reduced motion — звичайна непрозора панель.
