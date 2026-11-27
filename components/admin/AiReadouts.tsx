// Чтение: расход, квоты, кэш, остывание, ошибки. Серверные компоненты, без клиентского JS.
import type { BookCostEnv } from "@/app/admin/ai/_lib/book-cost";
import type { AdminSummary } from "@/app/admin/ai/_lib/stats";
import { Badge, Bar, Card, fmtIn, fmtPct, fmtTime, fmtUsd, Section, toneOfPct } from "./ui";

const TZ_LABEL: Record<string, string> = {
  "America/Los_Angeles": "по Тихоокеанскому времени",
  UTC: "по UTC",
};

const ENV_LABEL: Record<string, string> = { prod: "Прод", staging: "Превью (staging)" };

export function SpendSection({ s }: { s: AdminSummary }) {
  return (
    <Section
      id="spend"
      title="Расход"
      hint="Оценка по ценам из lib/ai/config.ts. Сутки и месяц — по UTC, как бюджеты в роутере."
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Сегодня" value={fmtUsd(s.totals.today)} />
        <Stat label="Месяц" value={fmtUsd(s.totals.month)} />
        <Stat label="Прогноз месяца" value={fmtUsd(s.totals.forecastMonth)} />
      </div>
      {/* #211: превью (staging) шлёт свой расход сюда — бюджеты ниже общие для обоих окружений */}
      <Card>
        <p className="font-medium">По окружениям</p>
        {(s.byEnv ?? []).map((e) => (
          <div key={e.env} className="mt-1 flex justify-between text-sm">
            <span>
              {ENV_LABEL[e.env] ?? e.env}: сегодня <b className="tabular-nums">{fmtUsd(e.today)}</b> · месяц{" "}
              <b className="tabular-nums">{fmtUsd(e.month)}</b>
            </span>
            <span className="text-muted tabular-nums">{e.callsMonth} выз.</span>
          </div>
        ))}
        <p className="mt-1 text-sm text-muted">Итог и бюджеты — по обоим окружениям: ключи ИИ одни.</p>
      </Card>
      {s.spend.map((p) => (
        <Card key={p.provider}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{p.provider}</span>
            <span className="flex gap-1">
              {p.paid ? <Badge tone="near">платный</Badge> : <Badge tone="ok">бесплатный</Badge>}
              {!p.enabled ? <Badge tone="off">выключен</Badge> : null}
            </span>
          </div>
          <BudgetLine label="Сегодня" spent={p.today} budget={p.dailyBudget} pct={p.todayPct} calls={p.callsToday} />
          <BudgetLine label="Месяц" spent={p.month} budget={p.monthlyBudget} pct={p.monthPct} calls={p.callsMonth} />
          <p className="mt-1 text-sm text-muted">Прогноз на месяц при текущем темпе: {fmtUsd(p.forecastMonth)}</p>
        </Card>
      ))}
    </Section>
  );
}

/** #105 п. 6: себестоимость книги — запросы и $ на семью с ≥ 1 готовой главой, медиана и p90, по окружениям. */
export function BookCostSection({ envs }: { envs: BookCostEnv[] }) {
  return (
    <Section
      id="book-cost"
      title="Себестоимость книги"
      hint="На семью с ≥ 1 готовой главой (без демо), за всё время. Запрос — обращение к модели (ответ из кэша не считается). Семья строки — ai_usage.family_id, иначе через историю."
    >
      {envs.map((e) => (
        <Card key={e.env}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{ENV_LABEL[e.env] ?? e.env}</span>
            <span className="text-sm text-muted tabular-nums">семей: {e.families}</span>
          </div>
          {e.families === 0 ? (
            <p className="mt-1 text-sm text-muted">
              {e.env === "staging"
                ? "Нет данных в этой базе: расход превью приходит в прод без семьи — смотрите /admin/ai на превью staging."
                : "Пока нет семей с готовой главой и расходом."}
            </p>
          ) : (
            <>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <Stat label="Запросов: медиана" value={fmtNum(e.requests.median)} />
                <Stat label="Запросов: p90" value={fmtNum(e.requests.p90)} />
                <Stat label="$: медиана" value={fmtUsd(e.usd.median)} />
                <Stat label="$: p90" value={fmtUsd(e.usd.p90)} />
              </div>
              <p className="mt-1 text-sm text-muted">
                Готовых глав на семью: медиана {fmtNum(e.chapters.median)}, p90 {fmtNum(e.chapters.p90)} · за главу в среднем{" "}
                {fmtUsd(e.usdPerChapter)}
              </p>
            </>
          )}
        </Card>
      ))}
    </Section>
  );
}

const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ","));

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-paper p-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function BudgetLine(props: { label: string; spent: number; budget: number | null; pct: number | null; calls: number }) {
  return (
    <div className="mt-2">
      <div className="flex justify-between text-sm">
        <span>
          {props.label}: <b className="tabular-nums">{fmtUsd(props.spent)}</b>
          {props.budget !== null ? <> из {fmtUsd(props.budget)}</> : <span className="text-muted"> · без бюджета</span>}
        </span>
        <span className="text-muted tabular-nums">{props.calls} выз.</span>
      </div>
      {props.pct !== null ? (
        <div className="mt-1">
          <Bar value={props.pct} tone={toneOfPct(props.pct)} label={`${props.label}: доля бюджета`} />
        </div>
      ) : null}
    </div>
  );
}

export function QuotaSection({ s }: { s: AdminSummary }) {
  return (
    <Section
      id="quotas"
      title="Бесплатные квоты"
      hint="Модели и лимиты — из таблицы ai_routes. Черта — порог, после которого роутер переходит к следующему."
    >
      {s.quotas.length === 0 ? <p className="text-sm text-muted">В маршрутах нет моделей с суточной квотой.</p> : null}
      {s.quotas.map((q) => (
        <Card key={`${q.provider}|${q.model}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="break-all font-medium">{q.model}</span>
            <Badge tone={q.state}>{q.state === "over" ? "порог достигнут" : q.state === "near" ? "близко к порогу" : "в норме"}</Badge>
          </div>
          <div className="mt-2">
            <Bar value={q.pct} tone={q.state} mark={q.threshold} label={`Квота ${q.model}`} />
          </div>
          <p className="mt-1 text-sm tabular-nums">
            <b>{fmtPct(q.pct)}</b> · {q.used} из {q.limit} · порог {q.cap} ({fmtPct(q.threshold)})
          </p>
          <p className="text-xs text-muted">
            {q.provider} · шаги: {q.steps.join(", ")} · сброс {TZ_LABEL[q.timeZone] ?? q.timeZone} через {fmtIn(s.now, q.resetsAt)} (
            {fmtTime(q.resetsAt)} Алматы)
          </p>
        </Card>
      ))}
      {s.unlimited.length > 0 ? (
        <div className="text-sm text-ink-soft">
          <p className="font-medium">Без суточной квоты (ограничены бюджетом):</p>
          <ul className="mt-1 flex flex-col gap-1">
            {s.unlimited.map((u) => (
              <li key={`${u.provider}|${u.model}`} className="break-all">
                {u.model} <span className="text-muted">· {u.provider} · сегодня {u.callsToday} выз.</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

export function CacheCoolingSection({ s }: { s: AdminSummary }) {
  return (
    <Section id="cache" title="Кэш и остывание">
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["Кэш сегодня", s.cache.today],
            ["Кэш за месяц", s.cache.month],
          ] as const
        ).map(([label, c]) => (
          <Card key={label}>
            <div className="text-xs text-muted">{label}</div>
            <div className="text-lg font-semibold tabular-nums">{fmtPct(c.share)}</div>
            <div className="text-xs text-muted tabular-nums">
              {c.hits} из {c.hits + c.calls} ответов
            </div>
          </Card>
        ))}
      </div>
      {s.cooling.length === 0 ? (
        <p className="text-sm text-muted">Сейчас ни одна модель не остывает.</p>
      ) : (
        s.cooling.map((c) => (
          <Card key={`${c.provider}|${c.model}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="break-all font-medium">{c.model}</span>
              <Badge tone="near">остывает ещё {fmtIn(s.now, c.until)}</Badge>
            </div>
            <p className="text-xs text-muted">
              {c.provider} · {c.status === "rate_limited" ? "429" : "таймаут"} в {fmtTime(c.failedAt, false)}, вернётся в{" "}
              {fmtTime(c.until, false)}
            </p>
          </Card>
        ))
      )}
    </Section>
  );
}

const STATUS_LABEL: Record<string, string> = { error: "ошибка", rate_limited: "429", timeout: "таймаут" };

export function ErrorsSection({ s }: { s: AdminSummary }) {
  return (
    <Section id="errors" title="Последние ошибки" hint="20 последних вызовов с ошибкой, 429 или таймаутом.">
      {s.errors.length === 0 ? <p className="text-sm text-muted">Ошибок нет.</p> : null}
      {s.errors.map((e, i) => (
        <Card key={`${e.created_at}-${i}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <b>{e.step}</b> · {e.provider}
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={e.status === "error" ? "over" : "near"}>{STATUS_LABEL[e.status] ?? e.status}</Badge>
              <span className="text-muted tabular-nums">{fmtTime(e.created_at)}</span>
            </span>
          </div>
          <p className="mt-1 break-all text-xs text-muted">{e.model}</p>
          {e.error ? <p className="mt-1 break-words text-sm text-ink-soft">{e.error}</p> : null}
        </Card>
      ))}
    </Section>
  );
}
