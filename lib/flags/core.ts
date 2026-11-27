// #223: чистая логика флагов — без process.env и без server-only, проверяется тестами.
import { FLAG_NAMES, FLAGS, isFlagName, type FlagName } from "./registry";
import type { VercelEnv } from "@/lib/env";

/** Контекст проверки: семья и её `families.labs`. Без labs флаг решается только окружением. */
export interface FlagCtx {
  familyId?: string | null;
  labs?: readonly string[] | null;
}

/** Что включено окружением (без семьи). `all` — `FLAGS_ON=*` или «по умолчанию все». */
export interface EnvFlags {
  all: boolean;
  names: ReadonlySet<string>;
  /** Откуда решение — для /admin/families и /api/health. */
  source: "FLAGS_ON" | "default";
}

/**
 * Окружение → включённые флаги.
 * - `FLAGS_ON` задан: список через запятую, `*` = все (в любом окружении, в том числе в Production).
 * - `FLAGS_ON` не задан: Production — ничего; Preview и локально / в тестах / в CI — все.
 *   Preview всё равно ставим явно `FLAGS_ON=*` в Vercel — так видно, что включено.
 */
export function envFlags(vercelEnv: VercelEnv, flagsOn: string | undefined): EnvFlags {
  const raw = flagsOn?.trim();
  if (raw === undefined || raw === "") {
    return { all: vercelEnv !== "production", names: new Set(), source: "default" };
  }
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { all: parts.includes("*"), names: new Set(parts.filter((p) => p !== "*")), source: "FLAGS_ON" };
}

/** Включён ли флаг: всем (`everyone`) → окружение (`FLAGS_ON` / по умолчанию) → семья (`labs`). */
export function isOn(name: FlagName, e: EnvFlags, ctx?: FlagCtx): boolean {
  if (FLAGS[name].everyone) return true;
  if (e.all || e.names.has(name)) return true;
  return Boolean(ctx?.labs?.includes(name));
}

/** Имена флагов, включённых окружением (без учёта семей) — для /api/health. */
export function flagsOnEnv(e: EnvFlags): FlagName[] {
  return FLAG_NAMES.filter((n) => isOn(n, e));
}

/** Все флаги со значением для семьи — чтобы передать в клиентский компонент пропсом. */
export function valuesFor(e: EnvFlags, ctx?: FlagCtx): Record<FlagName, boolean> {
  return Object.fromEntries(FLAG_NAMES.map((n) => [n, isOn(n, e, ctx)])) as Record<FlagName, boolean>;
}

/** labs семьи без мусора: только известные имена, без повторов, по алфавиту. */
export function cleanLabs(labs: readonly string[] | null | undefined): FlagName[] {
  return [...new Set((labs ?? []).filter(isFlagName))].sort();
}

/** Включить / выключить флаг семье: новый массив labs (неизвестные имена сохраняем — их мог завести другой PR). */
export function toggleLab(labs: readonly string[] | null | undefined, name: FlagName, on: boolean): string[] {
  const set = new Set(labs ?? []);
  if (on) set.add(name);
  else set.delete(name);
  return [...set].sort();
}
