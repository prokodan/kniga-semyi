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
  lang_kk: {
    description:
      "Книга на русском и казахском (#231): выбор «Языки книги» на странице семьи, перевод глав ru → kk, казахский в PDF; " +
      "интервью — проверка полноты и следующий вопрос одним вызовом ИИ, короткий ответ — уточнение без ИИ (#105 п. 1–2).",
    owner: "Данил",
    issue: 231,
  },
  culture_packs: {
    description:
      "Культурные пакеты #233: на /start семья выбирает «Кто ваша семья?» (корё-сарам / казахская / украинская / общий), язык рассказа и " +
      "языки книги; интервью задаёт вопросы по своим пакетам (общий костяк + слои), подсказки расшифровке — по пакетам, корейская строка " +
      "вопроса — только с корё-сарам.",
    owner: "Влад",
    issue: 233,
  },
  family_tree: {
    description:
      "Древо семьи #235 / #277: /f/<токен>/tree (строится само из глав и в шаге словаря конвейера, правит семья; ряды поколений, " +
      "капсулы пар, масштаб, «Списком», фото людей #269), страница древа в PDF книги, «Записать историю мамы».",
    owner: "Данил",
    issue: 235,
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
