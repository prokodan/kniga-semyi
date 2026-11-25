"use client";
// Озвучка вопроса (speechSynthesis) не должна попадать в запись (#100).
// Любой старт записи: сначала глушим озвучку и ждём её фактической остановки, потом включаем микрофон.
// На iOS speechSynthesis.cancel() срабатывает с задержкой — поэтому проверяем speaking / pending
// и добавляем страховку 300 мс. Пока идёт запись, озвучка заблокирована (speak() молчит).

let blocked = false;
const listeners = new Set<(blocked: boolean) => void>();

const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

/** Запись идёт (или включается) — озвучка запрещена. */
export function isSpeechBlocked(): boolean {
  return blocked;
}

export function setSpeechBlocked(value: boolean): void {
  if (blocked === value) return;
  blocked = value;
  if (value) synth()?.cancel();
  for (const l of listeners) l(value);
}

/** Подписка для кнопки «Прослушать вопрос»: во время записи она недоступна. */
export function onSpeechBlocked(listener: (blocked: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Страховка после остановки озвучки: iOS ещё доигрывает буфер. */
export const SPEECH_SAFETY_MS = 300;
/** Дольше не ждём: запись важнее, чем идеальная тишина. */
export const SPEECH_MAX_WAIT_MS = 1500;

/**
 * Остановить озвучку и дождаться, когда она действительно замолчит.
 * Если ничего не звучало — сразу (без задержки старта записи).
 */
export async function silenceSpeech(opts: { safetyMs?: number; maxWaitMs?: number } = {}): Promise<void> {
  const s = synth();
  if (!s) return;
  const safety = opts.safetyMs ?? SPEECH_SAFETY_MS;
  const maxWait = opts.maxWaitMs ?? SPEECH_MAX_WAIT_MS;
  const wasSpeaking = s.speaking || s.pending;
  s.cancel();
  if (!wasSpeaking) return;
  const t0 = Date.now();
  while ((s.speaking || s.pending) && Date.now() - t0 < maxWait) {
    await sleep(50);
    s.cancel(); // iOS иногда «проглатывает» первый cancel
  }
  await sleep(safety);
}
