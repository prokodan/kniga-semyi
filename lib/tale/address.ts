// Сказка без childName (#44): Flash-Lite иногда придумывает внуку имя («Знаешь, Алиса, …»), хотя промпт просит
// так не делать. Подстраховка в коде: обращение по имени, которого нет ни в главах, ни в имени рассказчика,
// заменяем нейтральным «дружок»; «внучка Маша» → «внучка». Без server-only: чистая функция, её видят тесты.

export const NEUTRAL_ADDRESS = "дружок";

const NAME = "[А-ЯЁ][а-яё]{1,15}";
/** Слова с заглавной в начале фразы, которые не имена: «Тогда, …», «Знаешь, …» и т.п. */
const NOT_NAMES = new Set(
  (
    "знаешь знаете смотри смотрите слушай послушай представь представляешь помнишь видишь вот ну да нет ой ах эх ох " +
    "ура итак тогда теперь потом сначала наконец конечно однажды ведь правда спасибо здравствуй привет пока " +
    "давным утром вечером ночью зимой летом весной осенью дружок малыш"
  ).split(" "),
);
const KIN = "(?:внук(?:а|у|ом|е|и)?|внучк(?:а|и|е|у|ой)|внучек|внучок|внученьк(?:а|е|у|ой)|правнук(?:а|у)?|правнучк(?:а|е|у))";

/** Слова источника (главы + имя рассказчика) — их имена не трогаем. */
export function knownWords(...texts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of (t ?? "").toLowerCase().match(/[а-яё]+/g) ?? []) out.add(w);
  return out;
}

/** Похоже ли слово на выдуманное имя: не служебное и не встречается (с учётом падежа) в источнике. */
function invented(word: string, known: Set<string>): boolean {
  const w = word.toLowerCase();
  if (NOT_NAMES.has(w) || known.has(w)) return false;
  const stem = w.slice(0, Math.max(3, w.length - 2));
  for (const k of known) if (k.length >= 3 && k.startsWith(stem)) return false;
  return true;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Убрать выдуманное имя ребёнка из текста сказки. Вызывать только когда childName не задан.
 * vocative — искать и голое обращение «…, Алиса, …» (только на последней странице: там сказка обращается к
 * ребёнку; на других страницах между запятыми бывают места и люди из глав).
 */
export function neutralizeChildName(text: string, known: Set<string>, opts: { vocative?: boolean } = {}): string {
  let out = text;
  // «Дорогая Алиса», «Милый Тимур» → «Дружок»
  out = out.replace(new RegExp(`(Дорог(?:ой|ая|ие)|дорог(?:ой|ая|ие)|Мил(?:ый|ая)|мил(?:ый|ая)|Любим(?:ый|ая))\\s+(${NAME})`, "gu"), (m, adj: string, name: string) =>
    invented(name, known) ? (adj[0] === adj[0]!.toUpperCase() ? cap(NEUTRAL_ADDRESS) : NEUTRAL_ADDRESS) : m,
  );
  // «внучка Маша» → «внучка»
  out = out.replace(new RegExp(`(${KIN})\\s+(${NAME})(?=[\\s,.!?…;:—)»]|$)`, "giu"), (m, kin: string, name: string) =>
    invented(name, known) ? kin : m,
  );
  // «Сказка для Алисы» → «Сказка для тебя»
  out = out.replace(new RegExp(`(^|[\\s«"(])(для|Для)\\s+(${NAME})(?=[\\s,.!?…;:—)»]|$)`, "gu"), (m, lead: string, dl: string, name: string) =>
    invented(name, known) ? `${lead}${dl} тебя` : m,
  );
  if (!opts.vocative) return out;
  // «…, Алиса, …» / «…, Алиса!» → «…, дружок, …»
  out = out.replace(new RegExp(`,(\\s*)(${NAME})(?=\\s*[,!?.…])`, "gu"), (m, sp: string, name: string) =>
    invented(name, known) ? `,${sp}${NEUTRAL_ADDRESS}` : m,
  );
  // «Алиса, послушай…» в начале фразы → «Дружок, послушай…»
  out = out.replace(new RegExp(`(^|[.!?…]\\s+|[«"—–]\\s*)(${NAME})(?=\\s*[,!])`, "gu"), (m, lead: string, name: string) =>
    invented(name, known) ? `${lead}${cap(NEUTRAL_ADDRESS)}` : m,
  );
  return out;
}
