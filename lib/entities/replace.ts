// Словарь имён семьи (#104): замена написания имени во всех главах. Чистые функции — тестируются напрямую.
//
// Русский: заменяем только целые слова (не «Ким» внутри «Кимчи», не «Лена» внутри «Леночка»).
// Падежи: если старое и новое написание кончаются одинаково («Вова» → «Вава», «Ерлан» → «Ерлин»),
// заменяем и формы с падежным окончанием («Вовы» → «Вавы», «Ерланом» → «Ерлином»). Если окончания разные
// Пара «-а» ↔ «-я» («Вова» → «Володя») склоняется по таблице окончаний («Вовы» → «Володи», «Вову» → «Володю»);
// прочие несовпадения окончаний — только точная форма: подбирать склонение без словаря опаснее, чем пропустить.
// Имена из нескольких слов («апа Сауле», «Иссык-Куль») — только точная фраза.
// Корейский: имя без пробела перед ним, после — ничего или частица (볼로댜가, 우슈토베에서).

const LETTER = "\\p{L}\\p{M}\\p{N}";
const VOWEL_END = /[аяоеёиыйьeaoiuy]$/iu;

/** Падежные окончания имён и топонимов (ед. и мн. число). Пустое — сама форма. */
const RU_ENDINGS = [
  "", "а", "я", "у", "ю", "е", "ы", "и", "о", "ой", "ей", "ом", "ем", "ым", "им", "ов", "ев", "ам", "ям", "ами", "ями", "ах", "ях", "ою", "ею",
  "ого", "его", "ому", "ему",
];

/** Частицы и окончания корейского после имени. */
const KO_PARTICLES = [
  "에게서", "께서", "에게", "에서", "한테", "이랑", "부터", "까지", "처럼", "보다", "와의", "과의", "으로", "이나", "이가", "이는", "이를", "이의", "이도",
  "이와", "이에게", "이랑", "이", "가", "은", "는", "을", "를", "의", "에", "께", "와", "과", "도", "만", "로", "나", "랑", "야", "아", "씨", "님",
].sort((a, b) => b.length - a.length);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normName(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

function isSingleWord(name: string): boolean {
  return !/[\s-]/.test(name);
}

function stem(word: string): string {
  return VOWEL_END.test(word) ? word.slice(0, -1) : word;
}

/** Окончания первого склонения: твёрдый вариант («Вова») → мягкий («Володя»). */
const HARD_TO_SOFT: Record<string, string> = { а: "я", ы: "и", у: "ю", е: "е", ой: "ей", ою: "ею", ам: "ям", ами: "ями", ах: "ях" };
const SOFT_TO_HARD: Record<string, string> = Object.fromEntries(Object.entries(HARD_TO_SOFT).map(([h, s]) => [s, h]));
SOFT_TO_HARD["е"] = "е";
SOFT_TO_HARD["и"] = "ы";

/**
 * Как склонять при замене: null — только точная форма; иначе функция «окончание старого → окончание нового»
 * (undefined — такую форму не трогаем). Условие: одно слово, основа ≥ 3 букв.
 */
function inflection(from: string, to: string): ((ending: string) => string | undefined) | null {
  if (!isSingleWord(from) || !isSingleWord(to)) return null;
  if (stem(from).length < 3 || stem(to).length < 2) return null;
  const a = from.slice(-1).toLowerCase();
  const b = to.slice(-1).toLowerCase();
  if (a === b || (!VOWEL_END.test(a) && !VOWEL_END.test(b))) return (e) => e;
  if (a === "а" && b === "я") return (e) => HARD_TO_SOFT[e];
  if (a === "я" && b === "а") return (e) => SOFT_TO_HARD[e];
  return null;
}

/** Первая буква как в найденном слове: «вова» в тексте со строчной — и замена со строчной. */
function withCase(found: string, repl: string): string {
  const f = found.charAt(0);
  if (!f) return repl;
  const upper = f === f.toUpperCase() && f !== f.toLowerCase();
  const first = repl.charAt(0);
  return (upper ? first.toUpperCase() : first.toLowerCase()) + repl.slice(1);
}

function ruPattern(from: string, inflect: boolean): RegExp {
  const body = inflect ? `${esc(stem(from))}(?:${RU_ENDINGS.filter(Boolean).map(esc).join("|")})?` : esc(from);
  // Для склоняемых: основа + окончание; «Вов» без окончания тоже совпадёт — поэтому ниже проверяем,
  // что совпало либо само слово, либо основа + окончание из списка.
  return new RegExp(`(?<![${LETTER}])(${body})(?![${LETTER}])`, "giu");
}

export interface Replaced {
  text: string;
  count: number;
}

function scanRu(text: string, from: string, inflect: boolean, repl: (found: string, ending: string | null) => string): Replaced {
  const fromStem = stem(from);
  let count = 0;
  const out = text.replace(ruPattern(from, inflect), (m: string) => {
    if (m.toLowerCase() === from.toLowerCase()) {
      count++;
      return repl(m, null);
    }
    if (!inflect) return m;
    const ending = m.slice(fromStem.length);
    if (!ending || !RU_ENDINGS.includes(ending.toLowerCase())) return m; // «Вов» — не форма «Вова»
    count++;
    return repl(m, ending);
  });
  return { text: out, count };
}

/** Заменить русское написание имени в тексте. Пустой / null текст — без изменений. */
export function replaceRu(text: string | null, fromRaw: string, toRaw: string): Replaced {
  const from = normName(fromRaw);
  const to = normName(toRaw);
  if (!text || !from || !to || from === to) return { text: text ?? "", count: 0 };
  const toStem = stem(to);
  const map = inflection(from, to);
  let count = 0;
  const { text: out } = scanRu(text, from, map !== null, (m, ending) => {
    const next = ending === null ? to : map!(ending.toLowerCase());
    if (next === undefined) return m; // форму не знаем — не трогаем
    count++;
    return withCase(m, ending === null ? to : toStem + next);
  });
  return { text: out, count };
}

/** Встречается ли имя (с падежными формами для однословных) в тексте. */
export function mentionsRu(text: string | null, nameRaw: string): boolean {
  const name = normName(nameRaw);
  if (!text || !name) return false;
  return scanRu(text, name, inflection(name, name) !== null, (m) => m).count > 0;
}

/** Заменить корейское написание имени: перед ним не буква, после — ничего или частица. */
export function replaceKo(text: string | null, fromRaw: string | null, toRaw: string | null): Replaced {
  const from = fromRaw ? normName(fromRaw) : "";
  const to = toRaw ? normName(toRaw) : "";
  if (!text || !from || !to || from === to || [...from].length < 2) return { text: text ?? "", count: 0 };
  const re = new RegExp(`(?<![${LETTER}])${esc(from)}(?=(?:${KO_PARTICLES.map(esc).join("|")})?(?![${LETTER}]))`, "gu");
  let count = 0;
  const out = text.replace(re, () => {
    count++;
    return to;
  });
  return { text: out, count };
}
