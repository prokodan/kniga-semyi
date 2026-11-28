-- #306 (флаг lang_change): согласие галочкой при смене / добавлении языков книги.
-- Решение Данила 28.11: голос заново не записываем; галочка «Согласен», дата и текст согласия (по новым языкам) — в базе.
-- Только добавляет таблицу. Докупленный язык — строка demo_orders (product = 'lang', extras = ["lang:kk"]), без новых колонок.
create table if not exists public.book_lang_consents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  storyteller_id uuid references public.storytellers(id) on delete set null,
  reason text not null check (reason in ('change', 'add')),
  from_langs text[] not null,
  langs text[] not null,
  text text not null,
  agreed_at timestamptz not null default now()
);
create index if not exists book_lang_consents_family_idx on public.book_lang_consents(family_id, agreed_at desc);
alter table public.book_lang_consents enable row level security;
grant all on table public.book_lang_consents to service_role;
