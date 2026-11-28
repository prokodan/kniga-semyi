-- #354 (v2 Q3, docs/v2/QUALITY_LOOP.md §2, §5.2–5.3): разбор отзывов проверяющих и предложения правок.
--   quality_findings  — находки разбора (quality-digest): компонент, важность, краткое описание, доказательства
--                       «было → правка носителя»; дубли сливаются в одну строку (count, feedback_ids).
--   quality_digests   — журнал запусков разбора (час / закрытие ссылки / кнопка): сколько отзывов, находок, $.
--   quality_digest_items — какие тексты ссылок уже разобраны (и по какой отметке времени отзыва).
--   quality_proposals — предложения правок (quality-propose → PR quality/<пара>-<дата>). Контракт с Q4 (#355):
--                       Q3 создаёт строку (draft → eval), Q4 читает и меняет status (ready | approved | rejected),
--                       eval_before / eval_after, reject_reason.
-- Только вымышленные данные (банк, eval, демо) и staging. Миграция только добавляет.

create table if not exists public.quality_proposals (
  id uuid primary key default gen_random_uuid(),
  pair text not null check (pair ~ '^[a-z]{2}-[a-z]{2}$'),
  -- id находок quality_findings, по которым построено предложение
  findings uuid[] not null default '{}',
  -- компоненты находок (prompt, glossary, check_rule, names, model_route) — для фильтров Q4
  components text[] not null default '{}',
  -- ветка quality/<пара>-<YYYYMMDD>[-N]; null — PR ещё не открыт
  branch text unique,
  pr_number int,
  pr_url text,
  -- файлы патча (только разрешённые: prompts/translate.<lang>.md, content/packs/*, eval/kk-check.ts, eval/kr-check.ts,
  -- eval/golden/<пара>.jsonl) и issues для того, что патчем не делается (код конвейера, маршруты моделей)
  files text[] not null default '{}',
  issues int[] not null default '{}',
  summary text not null default '',
  -- eval «до / после» по паре + золотой набор — пишет Q4 (#355) из комментария eval на PR
  eval_before jsonb,
  eval_after jsonb,
  -- draft — строится патч; eval — PR открыт, ждём eval; ready — eval готов (Q4); approved — слит; rejected — отклонён
  status text not null default 'draft' check (status in ('draft', 'eval', 'ready', 'approved', 'rejected')),
  reject_reason text,
  -- кто запустил: button (кнопка «Предложить правку»), auto (≥ 3 находок компонента), manual (Actions), selftest
  trigger text not null default 'manual',
  -- GitHub run id workflow quality-propose
  run_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quality_proposals_pair_idx on public.quality_proposals (pair, created_at desc);
create index if not exists quality_proposals_status_idx on public.quality_proposals (status);
drop trigger if exists quality_proposals_updated_at on public.quality_proposals;
create trigger quality_proposals_updated_at before update on public.quality_proposals for each row execute function set_updated_at();
alter table public.quality_proposals enable row level security;
grant all on table public.quality_proposals to service_role;

create table if not exists public.quality_findings (
  id uuid primary key default gen_random_uuid(),
  -- первый отзыв (review_feedback.id), из которого родилась находка; остальные дубли — в feedback_ids
  feedback_id uuid references public.review_feedback(id) on delete set null,
  feedback_ids uuid[] not null default '{}',
  -- тексты ссылок (review_items.id) и ссылки (review_links.id), где это нашли
  item_ids uuid[] not null default '{}',
  link_ids uuid[] not null default '{}',
  pair text not null check (pair ~ '^[a-z]{2}-[a-z]{2}$'),
  component text not null check (component in ('prompt', 'glossary', 'check_rule', 'names', 'model_route')),
  severity text not null default 'minor' check (severity in ('minor', 'major', 'critical')),
  summary text not null check (char_length(summary) between 1 and 400),
  -- [{kind: edit|term|comment, before, after, source?, paragraph?, item_id, feedback_id, reviewer, reviewed_at, …}] (≤ 8)
  evidence jsonb not null default '[]'::jsonb,
  -- что поменять: {kind: prompt_rule|glossary|check_rule|name|route|none, rule?, src?, wrong?, right?}
  fix jsonb not null default '{}'::jsonb,
  -- ключ слияния дублей: компонент + «неверно → верно» (или начало описания), нижний регистр
  fingerprint text not null,
  -- сколько раз нашли (слитые дубли)
  count int not null default 1 check (count >= 1),
  -- new — ждёт предложения; proposed — в предложении (proposal_id); dismissed — скрыта в «Находках»
  status text not null default 'new' check (status in ('new', 'proposed', 'dismissed')),
  proposal_id uuid references public.quality_proposals(id) on delete set null,
  digest_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quality_findings_pair_idx on public.quality_findings (pair, status, component);
create index if not exists quality_findings_fp_idx on public.quality_findings (pair, fingerprint);
create index if not exists quality_findings_proposal_idx on public.quality_findings (proposal_id) where proposal_id is not null;
drop trigger if exists quality_findings_updated_at on public.quality_findings;
create trigger quality_findings_updated_at before update on public.quality_findings for each row execute function set_updated_at();
alter table public.quality_findings enable row level security;
grant all on table public.quality_findings to service_role;

create table if not exists public.quality_digests (
  id uuid primary key default gen_random_uuid(),
  -- cron (pg_cron раз в час), link (проверяющий нажал «Готово»), button («Разобрать сейчас»), workflow (Actions)
  trigger text not null default 'cron',
  -- running → ok | partial (не всё успели / часть вызовов ИИ не удалась) | budget (лимит $ на сутки) | idle (нечего) | error
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'budget', 'idle', 'error')),
  items_seen int not null default 0,
  items_analyzed int not null default 0,
  findings_new int not null default 0,
  findings_merged int not null default 0,
  calls int not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  -- автоматически запущенные quality-propose: [{pair, component, count}]
  proposed jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists quality_digests_started_idx on public.quality_digests (started_at desc);
alter table public.quality_digests enable row level security;
grant all on table public.quality_digests to service_role;

create table if not exists public.quality_digest_items (
  item_id uuid primary key references public.review_items(id) on delete cascade,
  -- последняя отметка отзывов этого текста, которую разбор уже видел (review_feedback.updated_at)
  feedback_at timestamptz not null,
  digest_id uuid references public.quality_digests(id) on delete set null,
  findings int not null default 0,
  analyzed_at timestamptz not null default now()
);
alter table public.quality_digest_items enable row level security;
grant all on table public.quality_digest_items to service_role;

-- Шаг ИИ quality_analyze (lib/ai/types.ts): самая сильная модель OpenAI по ключу, как у quality_generate.
-- Должно совпадать с DEFAULT_ROUTES в lib/ai/config.ts.
insert into ai_routes (step, providers, timeout_ms) values
  ('quality_analyze', '[{"provider":"openai","model":"gpt-5.5"},{"provider":"openai","model":"gpt-5.4"},{"provider":"openai","model":"gpt-5.4-mini"}]', 45000)
on conflict (step) do nothing;

-- pg_cron 'quality-digest' раз в час (:23) → pg_net POST /api/cron/quality-digest, «Authorization: Bearer CRON_SECRET»
-- (тот же cron_secret из Vault, что у kick #171). Адрес — секрет Vault quality_digest_url, а если его нет — выводится из
-- kick_url (…/api/cron/kick → …/api/cron/quality-digest). Ручка сама молчит, где флаг quality_loop выключен (прод).
-- Без pg_cron / pg_net / Vault (PGlite в db:check) — только NOTICE.
do $do$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'quality_digest: pg_cron / pg_net недоступны (%), задание не создано', sqlerrm;
    return;
  end;
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'quality_digest: нет Supabase Vault, задание не создано';
    return;
  end if;

  begin
  perform cron.schedule(
    'quality-digest',
    '23 * * * *',
    $job$
      select net.http_post(
        url := s.url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 58000
      )
      from (
        select
          coalesce(
            (select decrypted_secret from vault.decrypted_secrets where name = 'quality_digest_url'),
            (select regexp_replace(decrypted_secret, '/api/cron/kick/?$', '/api/cron/quality-digest')
               from vault.decrypted_secrets where name = 'kick_url')) as url,
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret') as secret
      ) s
      where s.url like '%/api/cron/quality-digest' and s.secret is not null;
    $job$
  );
  exception when others then
    raise warning 'quality_digest: задание не создано: %', sqlerrm;
  end;
end
$do$;
