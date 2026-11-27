// #211: общий расход ИИ прода и превью (staging). Ключи Gemini / OpenAI одни → бюджеты $/день и $/мес общие.
//   Превью (VERCEL_ENV=preview, заданы AI_USAGE_SECRET и PROD_URL): каждую строку ai_usage пишет у себя (env=staging)
//   и отправляет в прод POST {PROD_URL}/api/ai/usage; бюджет берёт из сводки прода GET …/api/ai/usage/summary
//   (кэш 60 с), прод недоступен — считает по своей базе. Сбой отправки шаг не роняет (лог + локальная строка).
//   Прод: принимает строки (env=staging, без story_id — таких историй в проде нет) и считает бюджет по всем строкам.
// Квоты моделей (вызовы в сутки) и «остывание» — пока локально на каждой стороне (см. заметки PR #211).
// Без server-only: чистые функции и классы, тестируются в vitest; подключается из lib/ai/index.ts.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AiStore, UsageRow, UsageStatus } from "./store";
import { AI_PROVIDERS, type AiStep } from "./types";
import { startOfDayInTz, startOfUtcMonth } from "./util";

export const AI_USAGE_HEADER = "x-ai-usage-secret";
export const SUMMARY_CACHE_MS = 60_000;
/** После неудачной сводки не дёргаем прод ещё столько — считаем локально */
export const SUMMARY_RETRY_MS = 30_000;
export const SINK_TIMEOUT_MS = 2_500;

/** Секрет в постоянном времени (sha256 обеих сторон → одинаковая длина). Нет секрета на сервере → false. */
export function usageSecretOk(given: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

const STATUSES = ["ok", "error", "rate_limited", "timeout", "cache_hit"] as const satisfies readonly UsageStatus[];
const optInt = z.number().int().min(0).max(100_000_000).optional().nullable();

/** Строка, которую превью присылает в прод. Лишние поля отбрасываются; story_id не принимаем. */
export const remoteUsageSchema = z.object({
  row: z.object({
    step: z.string().min(1).max(40),
    provider: z.string().min(1).max(40),
    model: z.string().min(1).max(120),
    status: z.enum(STATUSES),
    input_tokens: optInt,
    output_tokens: optInt,
    audio_seconds: z.number().min(0).max(100_000).optional().nullable(),
    images: optInt,
    cost_usd: z.number().min(0).max(100),
    latency_ms: optInt,
    error: z.string().max(2_000).optional().nullable(),
    created_at: z.string().datetime({ offset: true }).optional(),
  }),
  /** Полный ref проекта Supabase отправителя — если совпал с продом, строка уже в базе (превью ещё смотрит в прод) */
  source_ref: z.string().max(64).optional(),
});

export type RemoteUsage = z.infer<typeof remoteUsageSchema>;

/** Строка для вставки в ai_usage прода. created_at — не позже «сейчас» и не старше суток (иначе now). */
export function toProdRow(input: RemoteUsage, now: Date = new Date()): UsageRow {
  const r = input.row;
  const t = r.created_at ? Date.parse(r.created_at) : NaN;
  const fresh = Number.isFinite(t) && t <= now.getTime() + 60_000 && t >= now.getTime() - 86_400_000;
  const clean = <T,>(v: T | null | undefined) => (v === null || v === undefined ? undefined : v);
  return {
    step: r.step as AiStep,
    provider: r.provider,
    model: r.model,
    status: r.status,
    input_tokens: clean(r.input_tokens),
    output_tokens: clean(r.output_tokens),
    audio_seconds: clean(r.audio_seconds),
    images: clean(r.images),
    cost_usd: r.cost_usd,
    latency_ms: clean(r.latency_ms),
    error: clean(r.error)?.slice(0, 500),
    created_at: fresh ? new Date(t).toISOString() : now.toISOString(),
    env: "staging",
  };
}

export interface UsageSummary {
  day_start: string;
  month_start: string;
  /** Расход по провайдерам, $ — все окружения вместе (так считает бюджет роутер прода) */
  spend: Record<string, { day: number; month: number }>;
}

/** Сводка для превью: те же окна, что у роутера (сутки и месяц UTC), по тому же store.spend. */
export async function buildUsageSummary(store: Pick<AiStore, "spend">, now: Date = new Date()): Promise<UsageSummary> {
  const day = startOfDayInTz("UTC", now);
  const month = startOfUtcMonth(now);
  const spend: UsageSummary["spend"] = {};
  for (const p of AI_PROVIDERS) {
    if (p === "mock") continue;
    const [d, m] = await Promise.all([store.spend(p, day), store.spend(p, month)]);
    spend[p] = { day: round(d), month: round(m) };
  }
  return { day_start: day.toISOString(), month_start: month.toISOString(), spend };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export interface SharedUsageOptions {
  /** Боевой адрес без «/» на конце */
  prodUrl: string;
  secret: string;
  /** Полный ref своего Supabase — прод по нему отличает «та же база» */
  sourceRef?: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Хранилище превью: всё как у локального, но расход уходит и в прод, а бюджет $ — общий (сводка прода).
 */
export class SharedUsageStore implements AiStore {
  private summary: { value: UsageSummary | null; at: number } | null = null;
  private inflight: Promise<UsageSummary | null> | null = null;
  /** Расход, отправленный после последней сводки, — чтобы кэш в 60 с не «прятал» свежие траты */
  private sentSince: Record<string, number> = {};
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(
    private local: AiStore,
    private opts: SharedUsageOptions,
  ) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  getRoute: AiStore["getRoute"] = (step) => this.local.getRoute(step);
  getProviderSettings: AiStore["getProviderSettings"] = (p) => this.local.getProviderSettings(p);
  countCalls: AiStore["countCalls"] = (p, m, since) => this.local.countCalls(p, m, since);
  hadFailureSince: AiStore["hadFailureSince"] = (p, m, since, st) => this.local.hadFailureSince(p, m, since, st);
  cacheGet: AiStore["cacheGet"] = (h) => this.local.cacheGet(h);
  cacheSet: AiStore["cacheSet"] = (h, s, p, m, o) => this.local.cacheSet(h, s, p, m, o);

  async recordUsage(row: UsageRow): Promise<void> {
    await this.local.recordUsage({ ...row, env: "staging" });
    await this.send(row);
  }

  async spend(provider: string, since: Date): Promise<number> {
    const s = await this.getSummary();
    if (s) {
      const t = since.getTime();
      const p = s.spend[provider];
      const extra = this.sentSince[provider] ?? 0;
      if (t === Date.parse(s.day_start)) return round((p?.day ?? 0) + extra);
      if (t === Date.parse(s.month_start)) return round((p?.month ?? 0) + extra);
    }
    return this.local.spend(provider, since);
  }

  /** Отправить строку в прод. Ошибка — только лог: шаг ИИ не падает. */
  async send(row: UsageRow): Promise<boolean> {
    const { story_id: _s, env: _e, ...rest } = row;
    void _s;
    void _e;
    try {
      const res = await this.fetchImpl(`${this.opts.prodUrl}/api/ai/usage`, {
        method: "POST",
        headers: { "content-type": "application/json", [AI_USAGE_HEADER]: this.opts.secret },
        body: JSON.stringify({ row: rest, source_ref: this.opts.sourceRef }),
        signal: AbortSignal.timeout(SINK_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        this.log(`[ai] расход не отправлен в прод: HTTP ${res.status}`);
        return false;
      }
      if (row.cost_usd > 0) this.sentSince[row.provider] = (this.sentSince[row.provider] ?? 0) + row.cost_usd;
      return true;
    } catch (e) {
      this.log(`[ai] расход не отправлен в прод: ${e instanceof Error ? e.name : "error"}`);
      return false;
    }
  }

  private async getSummary(): Promise<UsageSummary | null> {
    const t = this.now();
    if (this.summary) {
      const ttl = this.summary.value ? SUMMARY_CACHE_MS : SUMMARY_RETRY_MS;
      if (t - this.summary.at < ttl) return this.summary.value;
    }
    this.inflight ??= this.fetchSummary().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchSummary(): Promise<UsageSummary | null> {
    let value: UsageSummary | null = null;
    try {
      const res = await this.fetchImpl(`${this.opts.prodUrl}/api/ai/usage/summary`, {
        headers: { [AI_USAGE_HEADER]: this.opts.secret },
        signal: AbortSignal.timeout(SINK_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as Partial<UsageSummary>;
        if (body && typeof body.day_start === "string" && typeof body.month_start === "string" && body.spend) {
          value = { day_start: body.day_start, month_start: body.month_start, spend: body.spend };
        }
      }
      if (!value) this.log(`[ai] сводка расхода прода недоступна: HTTP ${res.status} — бюджет считаю локально`);
    } catch (e) {
      this.log(`[ai] сводка расхода прода недоступна: ${e instanceof Error ? e.name : "error"} — бюджет считаю локально`);
    }
    this.summary = { value, at: this.now() };
    if (value) this.sentSince = {};
    return value;
  }
}
