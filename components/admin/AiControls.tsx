// Переключатели: провайдеры (вкл/выкл, бюджеты, остывание) и маршруты шагов (вкл/выкл, закрепление,
// порядок, квота и порог). Обычные HTML-формы + server actions — работают и без JS на телефоне.
import {
  moveRouteEntry,
  pinProvider,
  saveProviderLimits,
  saveRouteEntry,
  toggleProvider,
  toggleRoute,
} from "@/app/admin/ai/actions";
import type { ProviderView, RouteView } from "@/app/admin/ai/_lib/routes";
import { DEFAULT_THRESHOLD } from "@/lib/ai/config";
import { Badge, btnCls, btnGhostCls, Card, inputCls, Section } from "./ui";

export function ProvidersSection({ providers }: { providers: ProviderView[] }) {
  return (
    <Section
      id="providers"
      title="Провайдеры"
      hint="Выключенный провайдер роутер пропускает со следующего вызова. Пустой бюджет — без ограничения."
    >
      {providers.map((p) => (
        <Card key={p.provider} id={`provider-${p.provider}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-lg font-medium">{p.provider}</span>
            <span className="flex gap-1">
              {p.enabled ? <Badge tone="ok">включён</Badge> : <Badge tone="off">выключен</Badge>}
              {p.paid ? <Badge tone="near">платный</Badge> : null}
              {p.source === "default" ? <Badge tone="info">нет строки в базе</Badge> : null}
            </span>
          </div>
          <form action={toggleProvider} className="mt-3">
            <input type="hidden" name="provider" value={p.provider} />
            <input type="hidden" name="enabled" value={String(!p.enabled)} />
            <button className={p.enabled ? btnGhostCls : btnCls} type="submit">
              {p.enabled ? "Выключить" : "Включить"}
            </button>
          </form>
          <form action={saveProviderLimits} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input type="hidden" name="provider" value={p.provider} />
            <Field label="Бюджет дня, $" name="daily_budget_usd" value={p.daily_budget_usd} step="0.01" />
            <Field label="Бюджет месяца, $" name="monthly_budget_usd" value={p.monthly_budget_usd} step="0.01" />
            <Field label="Остывание, мин" name="cooldown_minutes" value={p.cooldown_minutes} step="1" />
            <div className="sm:col-span-3">
              <button className={btnCls} type="submit">
                Сохранить лимиты
              </button>
            </div>
            {!p.paid ? (
              <p className="text-xs text-muted sm:col-span-3">Бюджеты действуют только для платных провайдеров (paid).</p>
            ) : null}
          </form>
        </Card>
      ))}
    </Section>
  );
}

function Field(props: { label: string; name: string; value: number | null | undefined; step: string; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-ink-soft">{props.label}</span>
      <input
        className={inputCls}
        name={props.name}
        type="number"
        inputMode="decimal"
        min={0}
        step={props.step}
        defaultValue={props.value ?? ""}
        placeholder={props.placeholder ?? "без лимита"}
      />
    </label>
  );
}

export function RoutesSection({ routes, openStep }: { routes: RouteView[]; openStep?: string }) {
  return (
    <Section
      id="routes"
      title="Маршруты шагов"
      hint="Роутер идёт по списку сверху вниз и берёт первую подходящую модель. Модели — из ai_routes, их обновляет workflow ai-models."
    >
      {routes.map((r) => (
        <RouteCard key={r.step} route={r} open={r.step === openStep} />
      ))}
    </Section>
  );
}

function RouteCard({ route: r, open }: { route: RouteView; open: boolean }) {
  const providerNames = [...new Set(r.providers.map((e) => e.provider))];
  return (
    <details id={`step-${r.step}`} open={open} className="scroll-mt-4 rounded-card border border-line bg-paper p-3 sm:p-4">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-medium">{r.step}</span>
        <span className="flex flex-wrap gap-1">
          {!r.enabled ? <Badge tone="off">выключен</Badge> : null}
          {r.pinned_provider ? <Badge tone="info">закреплён: {r.pinned_provider}</Badge> : null}
          {r.source === "default" ? <Badge tone="info">по умолчанию</Badge> : null}
          <span className="text-sm text-muted">{r.providers.map((e) => e.model).join(" → ") || "пусто"}</span>
        </span>
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <form action={toggleRoute}>
            <input type="hidden" name="step" value={r.step} />
            <input type="hidden" name="enabled" value={String(!r.enabled)} />
            <button className={r.enabled ? btnGhostCls : btnCls} type="submit">
              {r.enabled ? "Выключить шаг" : "Включить шаг"}
            </button>
          </form>
        </div>

        <form action={pinProvider} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="step" value={r.step} />
          <label className="flex grow flex-col gap-1 text-sm">
            <span className="text-ink-soft">Закрепить провайдера</span>
            <select name="pinned" defaultValue={r.pinned_provider ?? ""} className={inputCls}>
              <option value="">Нет — по порядку</option>
              {providerNames.map((p) => (
                <option key={p} value={p}>
                  Только {p}
                </option>
              ))}
            </select>
          </label>
          <button className={btnCls} type="submit">
            Применить
          </button>
        </form>

        <ol className="flex flex-col gap-2">
          {r.providers.map((e, i) => (
            <li key={`${i}-${e.provider}-${e.model}`} className="rounded-card bg-paper-deep p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted">
                    {i + 1}. {e.provider}
                  </div>
                  <div className="break-all font-medium">{e.model}</div>
                </div>
                <form action={moveRouteEntry} className="flex shrink-0 gap-1">
                  <EntryHidden step={r.step} index={i} provider={e.provider} model={e.model} />
                  <button className={btnGhostCls} type="submit" name="dir" value="up" disabled={i === 0} aria-label="Выше">
                    ↑
                  </button>
                  <button
                    className={btnGhostCls}
                    type="submit"
                    name="dir"
                    value="down"
                    disabled={i === r.providers.length - 1}
                    aria-label="Ниже"
                  >
                    ↓
                  </button>
                </form>
              </div>
              <form action={saveRouteEntry} className="mt-2 grid grid-cols-2 gap-2">
                <EntryHidden step={r.step} index={i} provider={e.provider} model={e.model} />
                <Field label="Квота в сутки" name="daily_limit" value={e.daily_limit} step="1" placeholder="нет" />
                <Field
                  label="Порог, %"
                  name="threshold_pct"
                  value={e.threshold !== undefined ? Math.round(e.threshold * 100) : undefined}
                  step="1"
                  placeholder={`${Math.round(DEFAULT_THRESHOLD * 100)}`}
                />
                <div className="col-span-2">
                  <button className={btnGhostCls} type="submit">
                    Сохранить квоту
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

function EntryHidden(p: { step: string; index: number; provider: string; model: string }) {
  return (
    <>
      <input type="hidden" name="step" value={p.step} />
      <input type="hidden" name="index" value={p.index} />
      <input type="hidden" name="provider" value={p.provider} />
      <input type="hidden" name="model" value={p.model} />
    </>
  );
}
