// #166: какую историю подталкивать (чистая функция — без server-only, для тестов).
import type { StoryStatus } from "@/lib/types";

/** Шаг конвейера ещё не закончен */
export const HEAL_ACTIVE: StoryStatus[] = ["uploaded", "transcribing", "editing", "translating"];
/** Стоит без изменений дольше — подтолкнуть (цепочка сервера между шагами укладывается в секунды) */
export const HEAL_STALE_MS = 90_000;
/** Не больше историй за один заход */
export const HEAL_MAX = 8;

export interface HealCandidate {
  id: string;
  status: StoryStatus;
  updated_at: string;
  step_started_at: string | null;
}

/** Нужно ли подтолкнуть: шаг не закончен, давно без изменений и сейчас не идёт (аренда истекла или её нет). */
export function needsHeal(s: HealCandidate, now: number, leaseMs: number): boolean {
  if (!HEAL_ACTIVE.includes(s.status)) return false;
  if (now - new Date(s.updated_at).getTime() < HEAL_STALE_MS) return false;
  if (s.step_started_at && now - new Date(s.step_started_at).getTime() < leaseMs) return false;
  return true;
}
