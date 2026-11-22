import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTES } from "./config";
import { promptPath } from "./prompts";
import { AI_STEPS } from "./types";

// Сид ai_routes в миграции и DEFAULT_ROUTES в коде должны совпадать,
// иначе поведение роутера зависит от того, настроена ли база.
describe("ai config", () => {
  const sql = readdirSync(path.join(process.cwd(), "supabase/migrations"))
    .sort()
    .map((f) => readFileSync(path.join(process.cwd(), "supabase/migrations", f), "utf8"))
    .join("\n");

  it.each(AI_STEPS)("маршрут %s в миграции совпадает с DEFAULT_ROUTES", (step) => {
    // последняя миграция с этим шагом побеждает (поздние миграции переопределяют маршрут через on conflict)
    const m = [...sql.matchAll(new RegExp(`\\('${step}', '(\\[.*?\\])', (\\d+)\\)`, "g"))].at(-1) ?? null;
    expect(m, `нет строки ai_routes для ${step}`).toBeTruthy();
    expect(JSON.parse(m![1]!)).toEqual(DEFAULT_ROUTES[step].providers);
    expect(Number(m![2])).toBe(DEFAULT_ROUTES[step].timeout_ms);
  });

  it.each(AI_STEPS)("у шага %s есть промпт", (step) => {
    expect(readFileSync(promptPath(step), "utf8").length).toBeGreaterThan(50);
  });
});
