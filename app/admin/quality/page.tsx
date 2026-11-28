// #352 (docs/v2/QUALITY_LOOP.md §3.1): вкладка «Банк» — вымышленные личности и тексты с нюансами по парам.
// Колонки: новые → в проверке → проверены → архив; у карточки — прогонов, ссылок, проверено, средняя оценка.
// «+ Личность», «+ Текст» (вручную), «Сгенерировать N» (шаг ИИ quality_generate), «В архив», «Прогнать» (Actions →
// quality-run на staging). Сид банка — Actions → quality-run, action seed.
import Link from "next/link";
import { Badge, Card, Notice, Section, btnCls, btnGhostCls, fmtTime, fmtUsd, inputCls } from "@/components/admin/ui";
import { bucketOf, defaultPack, wordCount } from "@/lib/quality/core";
import {
  BANK_BUCKETS,
  BUCKET_RU,
  EMPTY_COUNTERS,
  NUANCE_RU,
  NUANCE_TAGS,
  PAIR_RU,
  QUALITY_PAIRS,
  SOURCE_RU,
  isNuanceTag,
  type BankBucket,
  type CardCounters,
  type QualityPair,
  type QualityPersona,
  type QualityRun,
  type QualityText,
} from "@/lib/quality/types";
import { addPersonaAction, addTextAction, generateAction, runAction, setStatusAction } from "./actions";
import { QUALITY_RUN_URL, qualityRepo } from "./_lib/store";

export const dynamic = "force-dynamic";
/** «Сгенерировать N» ждёт модель — до лимита функции */
export const maxDuration = 60;

type Search = Promise<{ pair?: string; b?: string; msg?: string; tone?: string }>;

const chip = "inline-flex items-center rounded-button border border-line bg-paper px-2 py-0.5 text-xs text-ink-soft";
const RUN_STATUS: Record<QualityRun["status"], { label: string; tone: "ok" | "near" | "over" }> = {
  ok: { label: "готово", tone: "ok" },
  partial: { label: "частично", tone: "near" },
  budget: { label: "лимит $", tone: "near" },
  error: { label: "ошибка", tone: "over" },
};

function Counters({ c }: { c: CardCounters }) {
  return (
    <p className="text-sm text-ink-soft" data-testid="quality-counters">
      прогонов <b className="text-ink">{c.runs}</b> · ссылок <b className="text-ink">{c.links}</b> · проверено{" "}
      <b className="text-ink">{c.reviewed}</b> · средняя <b className="text-ink">{c.avg === null ? "—" : c.avg.toFixed(1)}</b>
      {c.lastRunAt ? <span className="text-muted"> · прогон {fmtTime(c.lastRunAt)}</span> : null}
    </p>
  );
}

function Tags({ tags }: { tags: readonly string[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className={chip}>
          {isNuanceTag(t) ? NUANCE_RU[t] : t}
        </span>
      ))}
    </span>
  );
}

function StatusButton({ pair, kind, id, archived }: { pair: QualityPair; kind: "persona" | "text"; id: string; archived: boolean }) {
  return (
    <form action={setStatusAction}>
      <input type="hidden" name="pair" value={pair} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={archived ? "active" : "archived"} />
      <button type="submit" className={btnGhostCls}>
        {archived ? "Вернуть из архива" : "В архив"}
      </button>
    </form>
  );
}

function TagBoxes({ name = "tags" }: { name?: string }) {
  return (
    <fieldset className="flex flex-wrap gap-2 text-sm">
      <legend className="mb-1">Теги нюансов</legend>
      {NUANCE_TAGS.map((t) => (
        <label key={t} className="flex min-h-12 items-center gap-2 rounded-button border border-line bg-paper px-3">
          <input type="checkbox" name={name} value={t} className="size-5" />
          {NUANCE_RU[t]}
        </label>
      ))}
    </fieldset>
  );
}

function PersonaSelect({ personas, optional }: { personas: QualityPersona[]; optional: string }) {
  return (
    <select name="persona_id" className={inputCls} defaultValue="">
      <option value="">{optional}</option>
      {personas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export default async function QualityBankPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const pair: QualityPair = (QUALITY_PAIRS as readonly string[]).includes(sp.pair ?? "") ? (sp.pair as QualityPair) : "ru-ko";
  const bucket: BankBucket | "all" = (BANK_BUCKETS as readonly string[]).includes(sp.b ?? "") ? (sp.b as BankBucket) : "all";

  const { repo, memory } = qualityRepo();
  let personas: QualityPersona[] = [];
  let texts: QualityText[] = [];
  let runs: QualityRun[] = [];
  let counters = new Map<string, CardCounters>();
  let spentToday = 0;
  let failed = false;
  try {
    const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    [personas, texts, runs, counters, spentToday] = await Promise.all([
      repo.personas(pair),
      repo.texts(pair),
      repo.runs(pair, 8),
      repo.counters(pair),
      repo.runSpendSince(dayStart),
    ]);
  } catch (e) {
    failed = true;
    console.error("[admin/quality]", e instanceof Error ? e.message : e);
  }

  const cOf = (id: string) => counters.get(id) ?? EMPTY_COUNTERS;
  const bucketCount = (b: BankBucket) =>
    personas.filter((p) => bucketOf(p.status, cOf(p.id)) === b).length + texts.filter((t) => bucketOf(t.status, cOf(t.id)) === b).length;
  const shown = <T extends { id: string; status: QualityPersona["status"] }>(xs: T[]) =>
    bucket === "all" ? xs : xs.filter((x) => bucketOf(x.status, cOf(x.id)) === bucket);
  const livePersonas = personas.filter((p) => p.status !== "archived");
  const nameOf = new Map(personas.map((p) => [p.id, p.name]));
  const href = (q: { pair?: string; b?: string }) => {
    const u = new URLSearchParams({ pair: q.pair ?? pair, ...(q.b && q.b !== "all" ? { b: q.b } : {}) });
    return `/admin/quality?${u}`;
  };
  const allRuns = [...counters.values()].reduce((s, c) => s + c.runs, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="quality-bank">
      {sp.msg ? <Notice tone={sp.tone === "err" ? "err" : "ok"}>{sp.msg}</Notice> : null}
      {memory ? <Notice tone="info">База не настроена — банк живёт в памяти сервера (локальный режим).</Notice> : null}
      {failed ? <Notice tone="err">Не удалось прочитать банк. Если миграция #352 ещё не прошла — запустите workflow migrate.</Notice> : null}

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Языковая пара">
        {QUALITY_PAIRS.map((p) => (
          <Link
            key={p}
            href={href({ pair: p, b: bucket })}
            aria-current={p === pair ? "page" : undefined}
            className={`flex min-h-12 items-center rounded-button border px-4 ${p === pair ? "border-jade bg-paper font-medium text-jade" : "border-line bg-paper"}`}
          >
            {PAIR_RU[p]}
          </Link>
        ))}
      </nav>

      <Section
        title={`Банк ${PAIR_RU[pair]}`}
        hint="Только вымышленные люди и тексты. Главы живых семей сюда не попадают никогда."
      >
        <p className="text-sm" data-testid="quality-summary">
          Личностей <b>{livePersonas.length}</b> · текстов <b>{texts.filter((t) => t.status !== "archived").length}</b> · прогонов{" "}
          <b>{allRuns}</b> · потрачено на прогоны сегодня <b>{fmtUsd(spentToday)}</b>
        </p>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Статус">
          {(["all", ...BANK_BUCKETS] as const).map((b) => (
            <Link
              key={b}
              href={href({ b })}
              aria-current={b === bucket ? "page" : undefined}
              className={`flex min-h-12 items-center gap-1 rounded-button border px-3 ${b === bucket ? "border-seal bg-seal text-paper" : "border-line bg-paper"}`}
            >
              {b === "all" ? "Все" : BUCKET_RU[b]} <span className="opacity-80">{b === "all" ? personas.length + texts.length : bucketCount(b)}</span>
            </Link>
          ))}
        </nav>
        <form action={runAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="pair" value={pair} />
          <label className="flex flex-col gap-1 text-sm">
            Что прогнать на staging
            <select name="kind" className={inputCls} defaultValue="all">
              <option value="all">Всё активное в паре</option>
              <option value="text">Только тексты</option>
              <option value="persona">Только личности</option>
            </select>
          </label>
          <button type="submit" className={btnCls} data-testid="quality-run">
            Прогнать
          </button>
          <a className="flex min-h-12 items-center text-sm underline" href={QUALITY_RUN_URL}>
            Actions → quality-run
          </a>
        </form>
        <p className="text-xs text-muted">
          Боевые промпты и маршруты ИИ staging; лимит — $2 на прогон и $5 на сутки (меняются при ручном запуске в Actions). В каждом прогоне
          записаны коммит, хэши файлов prompts/* и модели.
        </p>
      </Section>

      <Section title={`Личности · ${shown(personas).length}`}>
        {shown(personas).length === 0 ? <p className="text-ink-soft">Здесь пока пусто.</p> : null}
        <ul className="flex flex-col gap-2">
          {shown(personas).map((p) => (
            <li key={p.id} data-quality-persona={p.id}>
              <Card>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-base">{p.name}</b>
                    <span className={chip}>{p.pack}</span>
                    <Badge tone={p.status === "archived" ? "off" : "info"}>{BUCKET_RU[bucketOf(p.status, cOf(p.id))]}</Badge>
                    <span className="text-xs text-muted">{SOURCE_RU[p.source]}</span>
                  </div>
                  <Tags tags={p.tags} />
                  <Counters c={cOf(p.id)} />
                  <p className="text-sm text-ink-soft">{p.speech_style}</p>
                  <details className="text-sm">
                    <summary className="flex min-h-12 cursor-pointer items-center">Биография</summary>
                    <p className="whitespace-pre-line">{p.bio}</p>
                  </details>
                  <StatusButton pair={pair} kind="persona" id={p.id} archived={p.status === "archived"} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Тексты с нюансами · ${shown(texts).length}`}>
        {shown(texts).length === 0 ? <p className="text-ink-soft">Здесь пока пусто.</p> : null}
        <ul className="flex flex-col gap-2">
          {shown(texts).map((t) => (
            <li key={t.id} data-quality-text={t.id}>
              <Card>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-base">{t.event || "Без названия"}</b>
                    <Badge tone={t.status === "archived" ? "off" : "info"}>{BUCKET_RU[bucketOf(t.status, cOf(t.id))]}</Badge>
                    <span className="text-xs text-muted">
                      {t.persona_id ? (nameOf.get(t.persona_id) ?? "личность удалена") : "без личности"} · {wordCount(t.text_src)} слов ·{" "}
                      {SOURCE_RU[t.source]}
                    </span>
                  </div>
                  <Tags tags={t.nuance_tags} />
                  <Counters c={cOf(t.id)} />
                  <details className="text-sm">
                    <summary className="flex min-h-12 cursor-pointer items-center">Текст</summary>
                    <p className="whitespace-pre-line">{t.text_src}</p>
                    {t.focus_terms.length ? <p className="mt-2 text-ink-soft">Фокус-слова: {t.focus_terms.join(" · ")}</p> : null}
                  </details>
                  <StatusButton pair={pair} kind="text" id={t.id} archived={t.status === "archived"} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Сгенерировать" hint="Шаг ИИ quality_generate — самая сильная модель OpenAI по ключу staging. До 6 штук за раз, ≈ 20–50 с.">
        <form action={generateAction} className="flex flex-col gap-3" data-testid="quality-generate">
          <input type="hidden" name="pair" value={pair} />
          <div className="flex flex-wrap gap-2 text-sm">
            <label className="flex min-h-12 items-center gap-2 rounded-button border border-line bg-paper px-3">
              <input type="radio" name="kind" value="text" defaultChecked className="size-5" /> Тексты
            </label>
            <label className="flex min-h-12 items-center gap-2 rounded-button border border-line bg-paper px-3">
              <input type="radio" name="kind" value="persona" className="size-5" /> Личности
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Сколько (N)
            <input name="n" type="number" min={1} max={6} defaultValue={3} className={inputCls} />
          </label>
          <TagBoxes />
          <p className="text-xs text-muted">Теги не выбраны — возьмём те, текстов на которые в банке меньше всего.</p>
          <label className="flex flex-col gap-1 text-sm">
            Чей рассказ (для текстов)
            <PersonaSelect personas={livePersonas} optional="По очереди все личности пары" />
          </label>
          <button type="submit" className={btnCls}>
            Сгенерировать
          </button>
        </form>
      </Section>

      <Section title="Добавить вручную">
        <details>
          <summary className="flex min-h-12 cursor-pointer items-center font-medium">+ Личность</summary>
          <form action={addPersonaAction} className="mt-2 flex flex-col gap-3">
            <input type="hidden" name="pair" value={pair} />
            <label className="flex flex-col gap-1 text-sm">
              Имя (вымышленное)
              <input name="name" className={inputCls} maxLength={120} required autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Культурный пакет
              <select name="pack" className={inputCls} defaultValue={defaultPack(pair)}>
                <option value="koryo">koryo — корё-сарам</option>
                <option value="kz">kz — казахская семья</option>
                <option value="general">general — общий</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Биография — годы, места, родня (≥ 20 слов)
              <textarea name="bio" rows={6} className={`${inputCls} py-2`} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Манера речи
              <textarea name="speech_style" rows={3} className={`${inputCls} py-2`} />
            </label>
            <TagBoxes />
            <button type="submit" className={btnCls}>
              Добавить личность
            </button>
          </form>
        </details>
        <details>
          <summary className="flex min-h-12 cursor-pointer items-center font-medium">+ Текст</summary>
          <form action={addTextAction} className="mt-2 flex flex-col gap-3">
            <input type="hidden" name="pair" value={pair} />
            <label className="flex flex-col gap-1 text-sm">
              Чей рассказ
              <PersonaSelect personas={livePersonas} optional="Без личности" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              О чём (коротко)
              <input name="event" className={inputCls} maxLength={200} autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Текст — 100–250 слов, от первого лица
              <textarea name="text_src" rows={8} className={`${inputCls} py-2`} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Фокус-слова через запятую (как в тексте)
              <input name="focus_terms" className={inputCls} autoComplete="off" />
            </label>
            <TagBoxes />
            <button type="submit" className={btnCls}>
              Добавить текст
            </button>
          </form>
        </details>
      </Section>

      <Section title="Последние прогоны" hint="Подробности и тексты — в quality_runs / quality_items (staging); проверка носителем — вкладка «Проверки».">
        {runs.length === 0 ? <p className="text-ink-soft">Прогонов пары пока не было.</p> : null}
        <ul className="flex flex-col gap-1 text-sm" data-testid="quality-runs">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
              <span>{r.kind === "persona" ? "личность" : "текст"}</span>
              <span>{r.kind === "persona" ? nameOf.get(r.ref_id) : (texts.find((t) => t.id === r.ref_id)?.event ?? "—")}</span>
              <span className="text-muted">
                {fmtTime(r.created_at)} · {fmtUsd(r.cost_usd)} · вызовов {r.calls} · {r.commit_sha?.slice(0, 7) ?? "—"} · translate:{" "}
                {(r.models.used?.translate ?? []).join(", ") || "—"}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
