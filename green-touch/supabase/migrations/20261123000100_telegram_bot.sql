-- Telegram bot for order notifications.
-- A chat gets notifications only after signing in in the bot with an admin's
-- email and password (the same as /admin). Written only by Edge Functions.

create table public.telegram_chats (
  chat_id bigint primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tg_username text check (length(tg_username) <= 64),
  tg_name text check (length(tg_name) <= 128),
  linked_at timestamptz not null default now()
);

-- Sign-in dialog in the bot: which step a chat is on (the password is never stored).
create table public.telegram_login (
  chat_id bigint primary key,
  step text not null check (step in ('email', 'password')),
  email text check (length(email) <= 120),
  updated_at timestamptz not null default now()
);

alter table public.telegram_chats enable row level security;
alter table public.telegram_login enable row level security;

-- Admins see who receives notifications and can disconnect a chat.
grant select, delete on public.telegram_chats to authenticated;
create policy telegram_chats_admin_read on public.telegram_chats for select to authenticated using ((select private.is_admin()));
create policy telegram_chats_admin_delete on public.telegram_chats for delete to authenticated using ((select private.is_admin()));
