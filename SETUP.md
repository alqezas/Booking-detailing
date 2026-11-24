# Установка, локальный запуск и публикация

## Требования

Node 22+, pnpm 12, Docker Desktop (для локального Supabase), Supabase CLI и Vercel CLI (ставятся как
dev-зависимости: `npx supabase`, `npx vercel`).

## Локально

```bash
pnpm install
pnpm seed:generate        # supabase/seed.sql из tenants/*/business.json (демо-студии)
pnpm db:start             # локальный Supabase в Docker
pnpm db:reset             # миграции + seed
cp .env.example .env.local   # вписать ANON_KEY из `npx supabase status`
pnpm vapid:generate --write  # ключи push для локальной разработки
pnpm functions:serve      # edge-функции (помощники, диспетчер напоминаний)
pnpm dev                  # http://localhost:5173/s/graphite/
```

Кабинет: `http://localhost:5173/s/graphite/owner/`. Локальные демо-владельцы (`owner@graphite.demo`,
`owner@severny.demo`) создаются seed-ом; пароль — `scripts/lib/demo.ts` (только для локальной БД).

## Проверки

```bash
pnpm typecheck
pnpm test                 # модульные (роутер, агент, ICS, контраст, схемы)
pnpm test:db              # SQL/интеграционные на локальном Supabase
pnpm build && pnpm test:e2e   # Playwright: телефон + компьютер
E2E_BASE_URL=https://<сайт> pnpm test:e2e   # публичная часть против боевого сайта
npx tsx tests/integration/assistant-check.ts   # помощники на локальном стеке
npx tsx tests/integration/cloud-check.ts       # помощники и изоляция на облаке (.env.publish)
```

## Облако: Supabase

```bash
npx supabase login
npx supabase projects create studio-booking --org-id <org> --region eu-central-1 --db-password <пароль>
npx supabase link --project-ref <ref> -p <пароль>
npx supabase db push -p <пароль>          # миграции (pg_cron, pg_net, бакет фото включаются миграциями)
pnpm cloud:configure                      # адрес функций для cron (private.app_config)
pnpm functions:deploy                     # assistant, owner-assistant, notify-dispatch
npx supabase secrets set --env-file <файл> --project-ref <ref>
```

Секреты функций (`supabase/functions/.env.example`):

| Секрет | Назначение |
|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TOOL_MODE` | любая OpenAI-совместимая модель; без ключа помощники работают в упрощённом режиме по данным БД |
| `LLM_DAILY_TOKENS_PER_TENANT`, `LLM_DAILY_TOKENS_GLOBAL` | суточный бюджет (атомарные счётчики в БД) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (`pnpm vapid:generate`) |
| `ALLOWED_ORIGINS` | адрес сайта для CORS |

**Auth.** В облаке должна быть выключена регистрация и задан адрес сайта. `config.toml` хранит локальные
адреса, поэтому для облака используйте копию с боевыми `site_url`/`additional_redirect_urls` и
`npx supabase config push --workdir <папка-с-копией> --project-ref <ref>`; перед push — `config diff`.

**Cron.** Миграция создаёт задания `notify-dispatch` (каждую минуту, только если есть задачи) и `studio-cleanup`.
Секрет вызова генерируется в БД (`private.app_secrets`), функция проверяет его через `svc_check_cron_secret`.

## Облако: Vercel

```bash
npx vercel login
npx vercel link --yes --project studio-booking
npx vercel env add VITE_SUPABASE_URL production        # и VITE_SUPABASE_ANON_KEY, VITE_VAPID_PUBLIC_KEY
npx vercel pull --yes --environment=production
npx vercel build --prod && npx vercel deploy --prebuilt --prod
```

`vercel.json` отдаёт оболочку нужной студии на глубоких ссылках, `sw.js` без кэша и редиректит
`/s/<slug>` → `/s/<slug>/`, чтобы адрес оставался внутри области установленного приложения.

## Файлы с секретами (никогда не коммитятся)

`.env.local`, `.env.publish`, `supabase/functions/.env`, `.secrets/owners.local.txt`, `.vercel/`.
В сайт попадают только `VITE_*`: URL, publishable-ключ и публичный VAPID-ключ.

## Бьюти-студии: Telegram и проверки

Дополнительные секреты функций (`supabase/functions/.env.example`):

| Секрет | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | бот, через который владельцы получают мгновенные сообщения о записи/переносе/отмене клиентом (создать у @BotFather) |
| `SITE_URL` | адрес сайта для ссылки «Открыть кабинет» в сообщении |

```bash
npx supabase secrets set TELEGRAM_BOT_TOKEN=<токен> SITE_URL=https://<сайт> --project-ref <ref>
npx supabase db push -p <пароль>            # миграция 20261112000100_beauty.sql
pnpm functions:deploy                        # assistant, owner-assistant, notify-dispatch
```

Отправка идёт через тот же outbox `notification_jobs`: задачу будит pg_net сразу после коммита записи, страховка —
cron `notify-dispatch` раз в минуту. Без токена задача честно завершается `failed: TELEGRAM_BOT_TOKEN is not set`,
и владелец видит это в кабинете.

```bash
npx vitest run --project db tests/db/beauty.test.ts       # движок бьюти на локальном Supabase
npx tsx tests/integration/beauty-assistant-check.ts       # помощники на AURA/VELVET (нужен pnpm functions:serve)
npx tsx tests/integration/telegram-check.ts               # outbox → notify-dispatch → Bot API (без токена: честный failed)
TELEGRAM_TEST_CHAT_ID=<chat> npx tsx tests/integration/telegram-check.ts   # с токеном в functions/.env: реальная доставка
```

Локальные демо-владельцы бьюти-студий: `owner@aura-beauty.demo`, `owner@velvet-spa.demo` (пароль — `scripts/lib/demo.ts`).
