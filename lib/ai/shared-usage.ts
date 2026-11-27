// #211 → #218: расход ИИ превью (staging) — в отчёт прода.
//   С #218 у превью свои ключи Gemini / OpenAI (#237) → свои квоты, «остывание» и бюджет: превью считает всё по своей
//   базе (env=staging). Каждую строку ai_usage превью пишет у себя и отправляет в прод POST {PROD_URL}/api/ai/usage —
//   только для общего отчёта /admin/ai (строка «Превью (staging)»). Прод эти строки в квотах / остывании / бюджете
//   не учитывает (lib/ai/store.ts, isOwnUsage). Сбой отправки шаг не роняет (лог + локальная строка).
// Без server-only: чистые функции и классы, тестируются в vitest; подключается из lib/ai/index.ts.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AiStore, UsageRow, UsageStatus } from "./store";
import type { AiStep } from "./types";

export const AI_USAGE_HEADER = "x-ai-usage-secret";
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

export interface SharedUsageOptions {
  /** Боевой адрес без «/» на конце */
  prodUrl: string;
  secret: string;
  /** Полный ref своего Supabase — прод по нему отличает «та же база» */
  sourceRef?: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

/**
 * Хранилище превью: всё — как у локального (своя база staging, свои ключи и бюджет); каждая строка расхода
 * дополнительно уходит в прод для отчёта.
 */
export class SharedUsageStore implements AiStore {
  private readonly fetchImpl: typeof fetch;
  private readonly log: (message: string) => void;

  constructor(
    private local: AiStore,
    private opts: SharedUsageOptions,
  ) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  getRoute: AiStore["getRoute"] = (step) => this.local.getRoute(step);
  getProviderSettings: AiStore["getProviderSettings"] = (p) => this.local.getProviderSettings(p);
  countCalls: AiStore["countCalls"] = (p, m, since) => this.local.countCalls(p, m, since);
  spend: AiStore["spend"] = (p, since) => this.local.spend(p, since);
  hadFailureSince: AiStore["hadFailureSince"] = (p, m, since, st) => this.local.hadFailureSince(p, m, since, st);
  cacheGet: AiStore["cacheGet"] = (h) => this.local.cacheGet(h);
  cacheSet: AiStore["cacheSet"] = (h, s, p, m, o) => this.local.cacheSet(h, s, p, m, o);

  async recordUsage(row: UsageRow): Promise<void> {
    await this.local.recordUsage({ ...row, env: "staging" });
    await this.send(row);
  }

  /** Отправить строку в прод (для отчёта). Ошибка — только лог: шаг ИИ не падает. */
  async send(row: UsageRow): Promise<boolean> {
    // #204: семьи staging в проде нет — family_id, как и story_id, не отправляем.
    const { story_id: _s, family_id: _f, env: _e, ...rest } = row;
    void _s;
    void _f;
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
      return true;
    } catch (e) {
      this.log(`[ai] расход не отправлен в прод: ${e instanceof Error ? e.name : "error"}`);
      return false;
    }
  }
}
