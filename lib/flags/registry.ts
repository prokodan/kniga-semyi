// #223: реестр флагов функций. Один источник правды: имя флага = ключ объекта, неизвестное имя — ошибка типов.
// Без server-only: реестр читают и сервер, и CI-проверка строки «Флаг:» в PR (scripts/flag-line.ts).
//
// Как завести флаг — docs/HANDOFF.md §3 «Флаги»: строка здесь → `flag("<имя>", ctx)` в коде → `Флаг: <имя>` в PR.
// Выкатка: превью / staging (FLAGS_ON=*) → семьи из families.labs (/admin/families) → всем (PR «включить <имя>»:
// `everyone: true`) → PR «убрать флаг» (удалить строку и ветку `if` в коде).

export interface FlagInfo {
  /** Что меняется для семьи, когда флаг включён — одной фразой. */
  description: string;
  /** Кто ведёт выкатку: Данил | Влад. */
  owner: "Данил" | "Влад";
  /** Issue фичи. */
  issue: number;
  /** true — включён всем, в том числе в Production (PR «включить <имя>»). Дальше — PR «убрать флаг». */
  everyone?: boolean;
}

const DEFS = {
  demo_flag: {
    description: "Демонстрационный флаг #223: ничего не меняет у семей, только метка «🧪» в /admin/families. Можно удалить.",
    owner: "Данил",
    issue: 223,
  },
} as const satisfies Record<string, FlagInfo>;

export type FlagName = keyof typeof DEFS;

export const FLAGS: Readonly<Record<FlagName, FlagInfo>> = DEFS;

export const FLAG_NAMES = Object.keys(FLAGS) as FlagName[];

export function isFlagName(name: string): name is FlagName {
  return Object.prototype.hasOwnProperty.call(FLAGS, name);
}

export function flagInfo(name: FlagName): FlagInfo {
  return FLAGS[name];
}
