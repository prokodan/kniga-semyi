import "server-only";
// Публичный вход ИИ. Владелец — Z6. Использование:
//   import { ai } from "@/lib/ai";
//   const chapter = await ai.run("edit", { transcript, storytellerName, questionText, block });
// Ошибка AiUnavailableError → поставить историю в очередь / режим сцены (I2, I12).
import { getDbOrNull } from "@/lib/db";
import { createRouter, type AiRouter } from "./router";
import { MemoryStore, SupabaseStore, type AiStore } from "./store";

let store: AiStore | null = null;
let router: AiRouter | null = null;

export function getAiStore(): AiStore {
  if (!store) {
    const db = getDbOrNull();
    store = db ? new SupabaseStore(db) : new MemoryStore();
  }
  return store;
}

function getRouter(): AiRouter {
  router ??= createRouter({ store: getAiStore() });
  return router;
}

export const ai: AiRouter = {
  run: (step, input, opts) => getRouter().run(step, input, opts),
  runWithMeta: (step, input, opts) => getRouter().runWithMeta(step, input, opts),
};

export { AiUnavailableError, AI_STEPS, type AiStep, type AiInput, type AiOutput } from "./types";
export { getAiMode } from "@/lib/env";
