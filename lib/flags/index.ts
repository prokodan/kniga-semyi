import "server-only";
// #223: флаги функций. Всё новое по поведению — только за флагом (AGENTS.md, docs/HANDOFF.md §3 «Флаги»).
//
//   import { flag } from "@/lib/flags";
//   if (flag("new_book_layout", { familyId: family.id, labs: family.labs })) { … }
//
// Клиентский компонент сам флаги не читает: сервер считает `flagValues(ctx)` и передаёт пропсом
// (тип `FlagValues` и `isFlagOn` — из "@/lib/flags/shared", без server-only).
import { env } from "@/lib/env";
import { envFlags, flagsOnEnv, isOn, valuesFor, type EnvFlags, type FlagCtx } from "./core";
import type { FlagName } from "./registry";

export { FLAGS, FLAG_NAMES, isFlagName, type FlagName } from "./registry";
export { cleanLabs, toggleLab, type FlagCtx } from "./core";

/** Окружение читаем при каждом вызове — дёшево, и тесты могут менять process.env. */
export function currentEnvFlags(): EnvFlags {
  return envFlags(env.vercelEnv(), process.env.FLAGS_ON);
}

/** Включён ли флаг. Без ctx — только окружение; с `labs` семьи — ещё и выкатка по семьям. */
export function flag(name: FlagName, ctx?: FlagCtx): boolean {
  return isOn(name, currentEnvFlags(), ctx);
}

/** Все флаги для семьи — пропсом в клиентский компонент. */
export function flagValues(ctx?: FlagCtx): Record<FlagName, boolean> {
  return valuesFor(currentEnvFlags(), ctx);
}

/** Имена флагов, включённых окружением (без семей) — для /api/health. */
export function flagsOn(): FlagName[] {
  return flagsOnEnv(currentEnvFlags());
}
