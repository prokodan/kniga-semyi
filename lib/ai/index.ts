import "server-only";
// Публичный вход ИИ. Владелец — Z6. Использование:
//   import { ai } from "@/lib/ai";
//   const chapter = await ai.run("edit", { transcript, storytellerName, questionText, block });
// Ошибка AiUnavailableError → поставить историю в очередь / режим сцены (I2, I12).
import { getDbOrNull } from "@/lib/db";
import { env, isAiUsageSinkEnabled, supabaseRef, usageEnv } from "@/lib/env";
import { withStageFallback } from "@/lib/stage";
import { createRouter, type AiRouter } from "./router";
import { SharedUsageStore } from "./shared-usage";
import { MemoryStore, SupabaseStore, type AiStore } from "./store";

let store: AiStore | null = null;
let router: AiRouter | null = null;

export function getAiStore(): AiStore {
  if (!store) {
    const db = getDbOrNull();
    store = db ? new SupabaseStore(db, usageEnv() === "staging" ? "staging" : undefined) : new MemoryStore();
    // #211: превью (staging) шлёт расход в прод и берёт оттуда общий бюджет. Без AI_USAGE_SECRET — как раньше.
    if (db && isAiUsageSinkEnabled()) {
      store = new SharedUsageStore(store, {
        prodUrl: env.productionUrl()!,
        secret: env.aiUsageSecret()!,
        sourceRef: supabaseRef(),
      });
    }
  }
  return store;
}

function getRouter(): AiRouter {
  router ??= createRouter({ store: getAiStore() });
  return router;
}

export const ai: AiRouter = {
  // Режим сцены (I12): при STAGE_MODE=1 демо-история через 20 с без ответа получает готовый результат.
  run: (step, input, opts) => withStageFallback(opts?.storyId, step, () => getRouter().run(step, input, opts), { input }),
  runWithMeta: (step, input, opts) => getRouter().runWithMeta(step, input, opts),
};

export { AiUnavailableError, AI_STEPS, type AiStep, type AiInput, type AiOutput } from "./types";
export { getAiMode } from "@/lib/env";
