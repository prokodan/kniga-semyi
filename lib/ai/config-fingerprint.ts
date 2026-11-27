// #222: отпечаток настроек ИИ (ai_routes + ai_providers) — чтобы превью (staging) видело, совпадают ли его маршруты
// с продом. Прод отдаёт отпечаток в /api/health (`ai_routes_hash`), превью сравнивает со своим → `ai_routes_match_prod`.
// В отпечаток входят маршруты целиком (порядок моделей, квоты, таймаут, закрепление, вкл / выкл) и у провайдеров —
// enabled, paid, cooldown_minutes. Бюджеты ($/день, $/мес) НЕ входят: у превью они свои (#218).
// Без server-only: чистые функции, тест — lib/ai/config-fingerprint.test.ts.
import { createHash } from "node:crypto";

export interface RouteRowLike {
  step: string;
  providers: unknown;
  pinned_provider?: string | null;
  timeout_ms?: number | null;
  enabled?: boolean | null;
}

export interface ProviderRowLike {
  provider: string;
  enabled?: boolean | null;
  paid?: boolean | null;
  cooldown_minutes?: number | null;
}

/** JSON с ключами по алфавиту — порядок полей в jsonb / ответе PostgREST не влияет на отпечаток. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 12 hex-символов sha256 от маршрутов и настроек провайдеров (без бюджетов). */
export function aiConfigFingerprint(routes: RouteRowLike[], providers: ProviderRowLike[]): string {
  const r = [...routes]
    .sort((a, b) => (a.step < b.step ? -1 : a.step > b.step ? 1 : 0))
    .map((x) => ({
      step: x.step,
      providers: x.providers ?? null,
      pinned_provider: x.pinned_provider ?? null,
      timeout_ms: x.timeout_ms ?? null,
      enabled: x.enabled ?? true,
    }));
  const p = [...providers]
    .sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0))
    .map((x) => ({
      provider: x.provider,
      enabled: x.enabled ?? true,
      paid: x.paid ?? false,
      cooldown_minutes: x.cooldown_minutes ?? null,
    }));
  return createHash("sha256").update(stableJson({ routes: r, providers: p })).digest("hex").slice(0, 12);
}

/** Сравнение с продом: оба отпечатка есть → true / false; чего-то нет (прод недоступен, база не настроена) → null. */
export function routesMatch(own: string | null | undefined, prod: string | null | undefined): boolean | null {
  if (!own || !prod) return null;
  return own === prod;
}
