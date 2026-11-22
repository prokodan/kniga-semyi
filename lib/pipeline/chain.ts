import "server-only";
// Конвейер двигает сервер, а не открытый экран. Раньше шаги вызывал телефон (запись / экран главы): экран
// погас или закрыт — история навсегда «готовится…». Теперь после ответа ручки /process (и после загрузки
// записи) функция в after() сама вызывает /process для следующего шага — каждый шаг в своей функции со своими 60 с.
// Ответ не ждём (2,5 с — запрос дошёл): вызванная функция работает дальше без нас. Подстраховка — kick-stuck.
import { after } from "next/server";

/** Не больше шагов цепочки за один заход: transcribe → edit → translate → ready + запас */
export const MAX_CHAIN = 5;

export function continueInBackground(req: Request, storyId: string, token: string, depth = 0, body: Record<string, unknown> = {}) {
  if (depth >= MAX_CHAIN) return;
  const url = `${new URL(req.url).origin}/api/stories/${encodeURIComponent(storyId)}/process`;
  const run = async () => {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-token": token, "x-pipeline-chain": String(depth + 1) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2_500),
      });
    } catch {
      // таймаут ожидания ответа — нормально; сеть — подхватит экран главы или kick-stuck
    }
  };
  try {
    after(run);
  } catch {
    // вне запроса Next (тесты, скрипты) — цепочки нет, шаги вызывает тот, кто вызвал ручку
  }
}

export function chainDepth(req: Request): number {
  const n = Number(req.headers.get("x-pipeline-chain") ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Интервью закрыло вопрос (минимум собран / 3 уточнения / «позже» / пропуск) — собрать главу (пункт 4).
 * Если глава уже собиралась без уточнений (ждали дольше 20 мин), пересобираем с edit: при тех же словах
 * ответ модели берётся из кэша и ничего не стоит.
 */
export function releaseAfterInterview(req: Request, result: { type: string; storyId?: string | null }, token: string) {
  if (result.type === "followup" || !result.storyId) return;
  continueInBackground(req, result.storyId, token, 0, { from: "edit" });
}
