// #223: безопасно для клиентских компонентов — без server-only и без process.env.
// Значения флагов считает сервер (`flagValues(ctx)` из "@/lib/flags") и передаёт пропсом.
import type { FlagName } from "./registry";

export type { FlagName } from "./registry";

/** Значения флагов, пришедшие пропсом с сервера. Нет ключа — выключен. */
export type FlagValues = Partial<Record<FlagName, boolean>>;

export function isFlagOn(values: FlagValues | null | undefined, name: FlagName): boolean {
  return values?.[name] === true;
}
