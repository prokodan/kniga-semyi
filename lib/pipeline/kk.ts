// #298: казахский перевод так же надёжен, как корейский (флаг lang_kk — до этих функций доходит только перевод ru → kk).
// Чистые функции без ИИ (повтор шага ничего не стоит), общие для конвейера (steps/translate.ts), симулятора eval,
// kk-check и scripts/repair-chapters.ts:
//   1) алфавит (как fixCyrillic для ko, #163): латиница внутри казахского текста → кириллица. Смешанное слово
//      («dа», «кеlді») — латинские буквы-двойники → кириллица; слово целиком латиницей строчными («da», «bir») —
//      по казахской латинице 2021 (da → да, bir → бір). Заглавные латиницей (KGB, имена) и хангыль не трогаем — флажок;
//   2) обращение к внукам (как 해라체 #154): в абзаце, где к внукам на «сендер» (болыңдар, ұмытпаңдар), вежливые
//      формы множественного «сіздер» (болыңыздар, бір-біріңізге) → «сендер» — однозначные окончания; остальное — флажок;
//   3) имена семьи (как #121 #124 для ko): одно казахское написание имени / места во всей книге — family_entities.name_kk.
//      Написание узнаём из текста перевода без ИИ: казахские буквы — «двойники» русских (Сауле ↔ Сәуле, Уштобе ↔ Үштөбе).
import type { FamilyEntity } from "@/lib/types";
import { rankEntities, sameEntity } from "./entities";
import type { NamePair, Translated } from "./names";

export interface KkFix {
  /** script — алфавит, style — обращение к внукам, name — написание имени по словарю семьи, russian — русское слово (#315) */
  kind: "script" | "style" | "name" | "russian";
  from: string;
  to: string;
}

const KK_ONLY: Record<string, string> = { ә: "а", ғ: "г", қ: "к", ң: "н", ө: "о", ұ: "у", ү: "у", һ: "х", і: "и", ё: "е" };

/** Сравнимая форма: нижний регистр, казахские буквы → русские «двойники» (Сәуле → сауле, Үштөбе → уштобе). */
export function foldKk(s: string): string {
  return s.toLowerCase().replace(/[әғқңөұүһіё]/g, (c) => KK_ONLY[c]!);
}

const TOKEN = /\p{L}+/gu;
const LATIN = /[A-Za-zÀ-ɏ]/;
const CYR = /[Ѐ-ӿ]/;
export const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

// ── 1. Алфавит ──────────────────────────────────────────────────────────────

/** Латинские буквы, которые выглядят как кириллические (смешанное слово — опечатка модели). */
const LOOKALIKE: Record<string, string> = {
  a: "а", e: "е", o: "о", p: "р", c: "с", x: "х", y: "у", k: "к", i: "і",
  A: "А", B: "В", E: "Е", K: "К", M: "М", H: "Н", O: "О", P: "Р", C: "С", T: "Т", X: "Х", Y: "У", I: "І",
};
/** Казахская латиница 2021 → кириллица (для слова целиком латиницей). Сначала диграфы. */
const KZ_LATIN_DI: [string, string][] = [["sh", "ш"], ["ch", "ч"], ["zh", "ж"]];
const KZ_LATIN: Record<string, string> = {
  a: "а", ä: "ә", b: "б", d: "д", e: "е", f: "ф", g: "г", ğ: "ғ", h: "х", i: "і", ı: "ы", j: "ж", k: "к", l: "л", m: "м",
  n: "н", ñ: "ң", o: "о", ö: "ө", p: "п", q: "қ", r: "р", s: "с", ş: "ш", t: "т", u: "у", ū: "ұ", ü: "ү", v: "в", w: "у",
  y: "й", z: "з", c: "с", x: "х",
};

/** Слово целиком строчной латиницей → кириллица; null — есть буквы вне таблицы. */
export function kzLatinToCyr(word: string): string | null {
  let w = word;
  for (const [l, c] of KZ_LATIN_DI) w = w.split(l).join(c);
  let out = "";
  for (const ch of w) {
    if (CYR.test(ch)) out += ch;
    else if (KZ_LATIN[ch]) out += KZ_LATIN[ch];
    else return null;
  }
  return out;
}

function fixToken(tok: string, ru: string): string | null {
  if (!LATIN.test(tok)) return null;
  if (CYR.test(tok)) {
    // смешанное слово: двойники → кириллица, оставшаяся латиница — по таблице казахской латиницы
    let out = "";
    for (const ch of tok) {
      if (!LATIN.test(ch)) out += ch;
      else if (LOOKALIKE[ch]) out += LOOKALIKE[ch];
      else if (KZ_LATIN[ch.toLowerCase()]) out += ch === ch.toLowerCase() ? KZ_LATIN[ch]! : KZ_LATIN[ch.toLowerCase()]!.toUpperCase();
      else return null;
    }
    return out;
  }
  // целиком латиницей: только строчные (заглавные — аббревиатура / имя / бренд — не угадываем) и не из оригинала
  if (tok !== tok.toLowerCase() || tok.length > 15) return null;
  if (new RegExp(`(^|[^\\p{L}])${tok}($|[^\\p{L}])`, "iu").test(ru)) return null;
  return kzLatinToCyr(tok);
}

/** Латиница в казахском тексте → кириллица (что исправить однозначно). Остальное — флажок `latin` / `hangul`. */
export function fixKkScript(text: string, ru = ""): { text: string; fixed: KkFix[] } {
  const fixed: KkFix[] = [];
  const out = text.replace(TOKEN, (tok) => {
    const to = fixToken(tok, ru);
    if (!to || to === tok) return tok;
    fixed.push({ kind: "script", from: tok, to });
    return to;
  });
  return { text: out, fixed };
}

/** Что осталось не по алфавиту: слова латиницей (кроме тех, что есть в оригинале) и хангыль. */
export function kkScriptLeft(text: string, ru = ""): { latin: string[]; hangul: boolean } {
  const latin = [...new Set((text.match(TOKEN) ?? []).filter((t) => LATIN.test(t) && !new RegExp(`(^|[^\\p{L}])${t}($|[^\\p{L}])`, "iu").test(ru)))];
  return { latin, hangul: HANGUL.test(text) };
}

// ── 2. Обращение к внукам ───────────────────────────────────────────────────

/** «Сендер»: местоимение, повелительное мн. ч. (болыңдар, ұмытпаңдар, біліңдерші), притяжательное мн. ч. (балаларың). */
const FAMILIAR = /^(сендер\p{L}*|\p{L}+(ңдар|ңдер)(шы|ші)?)$/u;
/** «Сіздер» и вежливые формы 2-го лица: сіздер*, болыңыздар, біліңіздер, біріңізге, сіздің… */
const POLITE = /^(сіз\p{L}*|\p{L}+(ңыз|ңіз)\p{L}*)$/u;
/** Слова, где «ңіз» — часть корня, а не окончание: теңіз (море) и т. п. */
const POLITE_NOT = /^(теңіз|кеңіз|Теңіз)/u;

/** Абзацы — строки текста (пустые тоже считаются, чтобы номера совпадали при замене). */
const paragraphs = (text: string) => text.split("\n");

export interface StyleMix {
  paragraph: number;
  familiar: string;
  polite: string;
}

/** Абзацы, где к внукам и на «сендер», и на «сіздер» (флажок style:grandkids для kk). */
export function grandkidsMixedKk(text: string | null | undefined): StyleMix[] {
  const out: StyleMix[] = [];
  paragraphs(text ?? "").forEach((p, i) => {
    const toks = p.match(TOKEN) ?? [];
    const fam = toks.find((t) => FAMILIAR.test(t.toLowerCase()));
    const pol = toks.find((t) => POLITE.test(t.toLowerCase()) && !POLITE_NOT.test(t));
    if (fam && pol) out.push({ paragraph: i + 1, familiar: fam, polite: pol });
  });
  return out;
}

/** Однозначные замены «сіздер» → «сендер» (окончания, без корня): болыңыздар → болыңдар, біріңізге → біріңе. */
const POLITE_TO_FAMILIAR: [RegExp, string][] = [
  [/^([Сс])іздер/u, "$1ендер"],
  [/^(\p{L}+)ңыздар(шы)?$/u, "$1ңдар$2"],
  [/^(\p{L}+)ңіздер(ші)?$/u, "$1ңдер$2"],
  [/^(\p{L}+)ңызға$/u, "$1ңа"],
  [/^(\p{L}+)ңізге$/u, "$1ңе"],
];

/** В абзацах со смешением — вежливое мн. ч. к внукам → «сендер», где окончание однозначно. */
export function fixGrandkidsKk(text: string): { text: string; fixed: KkFix[] } {
  const fixed: KkFix[] = [];
  const mixed = new Set(grandkidsMixedKk(text).map((m) => m.paragraph));
  if (!mixed.size) return { text, fixed };
  const res = paragraphs(text).map((part, i) => {
    if (!mixed.has(i + 1)) return part;
    return part.replace(TOKEN, (tok) => {
      if (POLITE_NOT.test(tok)) return tok;
      for (const [re, to] of POLITE_TO_FAMILIAR) {
        if (re.test(tok)) {
          const next = tok.replace(re, to);
          fixed.push({ kind: "style", from: tok, to: next });
          return next;
        }
      }
      return tok;
    });
  });
  return { text: res.join("\n"), fixed };
}

// ── 3. Имена семьи ──────────────────────────────────────────────────────────

type Entity = Pick<FamilyEntity, "id" | "kind" | "name_ru" | "source" | "story_ids" | "updated_at"> & { name_kk?: string | null };

/** Годится как казахское написание: кириллица, без латиницы и хангыля, коротко. */
export function validKk(kk: string | null | undefined): string | null {
  const v = (kk ?? "").replace(/\s+/g, " ").trim();
  if (!v || v.length > 40 || !CYR.test(v) || LATIN.test(v) || HANGUL.test(v)) return null;
  return v;
}

/** Обязательные написания: люди и места словаря с name_kk; правка семьи — первой. */
export function requiredSpellingsKk(list: Entity[]): NamePair[] {
  const out: NamePair[] = [];
  for (const e of rankEntities(list)) {
    if (e.kind !== "person" && e.kind !== "place") continue;
    const kk = validKk(e.name_kk);
    if (!kk || out.some((p) => sameEntity(p.ru, e.name_ru))) continue;
    out.push({ ru: e.name_ru, ko: kk });
  }
  return out;
}

/**
 * Словарь во вход перевода ru → kk. Поле `ko` во входе translate — «написание на языке перевода» (имя поля — с L0,
 * контракт lib/ai/types.ts не меняем); prompts/translate.kk.md объясняет это модели.
 */
export function namesForTranslateKk(list: Entity[]): NamePair[] {
  return requiredSpellingsKk(list).slice(0, 60);
}

/** Окончания после имени (Сәуленің, Үштөбеде, Үштөбеден, Әбенге…) — только цепочка известных казахских аффиксов. */
const SUFFIX = /^(?:-?)(?:лар|лер|дар|дер|тар|тер|ның|нің|дың|дің|тың|тің|ға|ге|қа|ке|на|не|ны|ні|ды|ді|ты|ті|да|де|та|те|нда|нде|дан|ден|тан|тен|нан|нен|мен|бен|пен|ым|ім|ың|ің|сы|сі|ы|і|а|е|н|м|ң|ша|ше|ғы|гі|қы|кі|ов|ова|ев|ева)*$/u;

const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();

/** Вариант слова имени в казахском тексте: слово с заглавной, «двойник» по буквам + окончание. Самый частый. */
function variantOf(text: string, word: string): string | null {
  const w = foldKk(word);
  if (w.length < 3) return null;
  const count = new Map<string, number>();
  for (const tok of text.match(TOKEN) ?? []) {
    if (!isUpper(tok[0]!) || tok.length < word.length) continue;
    const head = tok.slice(0, word.length);
    if (foldKk(head) !== w || !SUFFIX.test(tok.slice(word.length))) continue;
    count.set(head, (count.get(head) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Как имя из словаря (по-русски) написано в казахском тексте; null — не нашли (Алма-Ата → Алматы и т. п.). */
export function spellingInKk(text: string, nameRu: string): string | null {
  const words = nameRu.trim().split(/\s+/);
  const out: string[] = [];
  for (const w of words) {
    const parts = w.split("-");
    const got = parts.map((p) => variantOf(text, p));
    if (got.some((g) => !g)) return null;
    out.push(got.join("-"));
  }
  const v = validKk(out.join(" "));
  return v;
}

/** Запомнить написание: люди и места этой главы без name_kk — как они написаны в казахском тексте. */
export function learnSpellingsKk(list: Entity[], text: string, storyId: string): { id: string; name_kk: string }[] {
  const out: { id: string; name_kk: string }[] = [];
  for (const e of list) {
    if (e.kind !== "person" && e.kind !== "place") continue;
    if (validKk(e.name_kk) || !(e.story_ids ?? []).includes(storyId)) continue;
    const kk = spellingInKk(text, e.name_ru);
    if (kk) out.push({ id: e.id, name_kk: kk });
  }
  return out;
}

/** Привести написания к словарю: другой «двойник» имени (Сауле, когда в книге Сәуле) → словарное написание. */
export function applySpellingsKk(text: string, required: NamePair[]): { text: string; fixed: KkFix[] } {
  const fixed: KkFix[] = [];
  let out = text;
  for (const r of required) {
    for (const word of r.ko.split(/[\s-]+/)) {
      const w = foldKk(word);
      if (w.length < 3) continue;
      out = out.replace(TOKEN, (tok) => {
        if (tok.length < word.length || !isUpper(tok[0]!)) return tok;
        const head = tok.slice(0, word.length);
        if (head === word || foldKk(head) !== w || !SUFFIX.test(tok.slice(word.length))) return tok;
        fixed.push({ kind: "name", from: head, to: word });
        return word + tok.slice(word.length);
      });
    }
  }
  return { text: out, fixed };
}

// ── 4. Русские слова (#315) ─────────────────────────────────────────────────
// У рассказчика ru+kk (serik) русские вставки переводчик оставлял как есть: «было», «но», «конечно», «глинобитные».
// Исправляем без ИИ только однозначные служебные слова; остальное — флажок `russian` и повтор с замечанием (#313).

/**
 * Русские служебные слова, которых нет в казахском. Осторожно: «не» (= что), «он» (= десять), «а», «да», «там»
 * (= строение), «так» (= нечётный), «от» (= огонь), «у» (= яд), «же» (= ешь), «на», «мен», «бар», «сол» — казахские
 * слова (или встречаются в казахской речи), их здесь нет.
 */
const RUSSIAN_STOP = new Set([
  "и", "в", "во", "на", "что", "чтобы", "как", "был", "была", "было", "были", "это", "этот", "эта", "эти", "они", "она", "оно",
  "мы", "вы", "но", "или", "когда", "потом", "тоже", "очень", "только", "бы", "по", "из", "для", "со", "к",
  "его", "её", "мне", "меня", "нас", "нам", "их", "где", "уже", "ещё", "еще", "всё", "все", "конечно", "однако",
  "потому", "поэтому", "даже", "вот", "если", "чем", "тогда", "сейчас", "просто", "вообще", "ведь",
]);

/** Слова, которые так и живут в казахском (советские реалии и общие заимствования), — не русская вставка. */
const SHARED_WORDS = new Set([
  "колхоз", "совхоз", "бригадир", "бригада", "трактор", "комбайн", "машина", "завод", "фабрика", "шахта", "вагон", "поезд",
  "станция", "радио", "кино", "клуб", "театр", "армия", "партия", "комсомол", "пионер", "райком", "обком", "сельсовет",
  "ферма", "почта", "автобус", "самолёт", "самолет", "телефон", "телевизор", "институт", "университет", "техникум",
  "студент", "инженер", "агроном", "врач", "директор", "магазин", "базар", "тонна", "километр", "метр", "рубль", "той",
]);

/** Окончания, по которым слово оригинала, оставшееся в казахском тексте как есть, — русское (глинобитные, жили, было). */
const RUSSIAN_ENDING = /(ые|ый|ий|ой|ая|яя|ое|ее|ого|его|ому|ему|ыми|ими|ых|их|ться|тся|лся|лась|лись|ла|ло|ли|ет|ют|ут|ешь|ость|ение|ание|ство|ями|ами)$/u;

const lowerWords = (s: string) => s.toLowerCase().match(TOKEN) ?? [];

/**
 * Русские слова, оставшиеся в казахском тексте: служебные из списка — всегда; слово оригинала как есть (строчными,
 * ≥ 5 букв, без казахских букв, с русским окончанием) — если его нет среди общих слов. Имена (с заглавной) не трогаем.
 */
export function russianLeftKk(text: string, ru = ""): string[] {
  // ≥ 5 букв: казахские слова в русском оригинале рассказчика ru+kk («бала») короче или с казахскими буквами
  const ruWords = new Set(lowerWords(ru));
  const out = new Set<string>();
  for (const tok of text.match(TOKEN) ?? []) {
    if (!CYR.test(tok) || /[әғқңөұүһі]/i.test(tok)) continue;
    const w = tok.toLowerCase();
    if (RUSSIAN_STOP.has(w)) out.add(w);
    else if (tok === w && w.length >= 5 && ruWords.has(w) && !SHARED_WORDS.has(w) && RUSSIAN_ENDING.test(w)) out.add(w);
  }
  return [...out];
}

/** Однозначные замены без ИИ: служебное слово → казахское (с сохранением заглавной). */
const RUSSIAN_TO_KK: Record<string, string> = { конечно: "әрине", но: "бірақ", однако: "алайда", очень: "өте", поэтому: "сондықтан" };

/** Казахские формы «аул» → «ауыл» (глоссарий: не «аул»): только целые слова из списка, «аулақ», «аулау» не трогаем. */
const AUL: Record<string, string> = {
  аул: "ауыл", аулда: "ауылда", аулдан: "ауылдан", аулға: "ауылға", аулдың: "ауылдың", аулды: "ауылды", аулы: "ауылы",
  аулым: "ауылым", аулымыз: "ауылымыз", аулымызда: "ауылымызда", аулдағы: "ауылдағы", аулдар: "ауылдар",
};

const keepCase = (from: string, to: string) => (from[0] !== from[0]!.toLowerCase() ? to[0]!.toUpperCase() + to.slice(1) : to);

/** «конечно» → «әрине», «но» → «бірақ», «аул» → «ауыл»… Остальные русские слова — флажок (russianLeftKk). */
export function fixRussianKk(text: string, ru = ""): { text: string; fixed: KkFix[] } {
  const fixed: KkFix[] = [];
  const out = text.replace(TOKEN, (tok) => {
    const w = tok.toLowerCase();
    const to = RUSSIAN_TO_KK[w] ?? (AUL[w] && !new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, "iu").test(ru) ? AUL[w] : undefined);
    if (!to) return tok;
    const next = keepCase(tok, to);
    fixed.push({ kind: "russian", from: tok, to: next });
    return next;
  });
  return { text: out, fixed };
}

// ── Всё вместе: после перевода ru → kk ──────────────────────────────────────

export interface KkResult<T extends Translated> {
  out: T;
  fixed: KkFix[];
  /** Что исправить не удалось — для логов, kk-check, повтора с замечанием (#313) и repair-chapters */
  left: { latin: string[]; hangul: boolean; style: StyleMix[]; russian: string[] };
}

/** Алфавит → русские слова → обращение к внукам → имена по словарю (text_ko / title_ko / quote_ko = казахский текст). */
export function finishKk<T extends Translated>(raw: T, ru: string, required: NamePair[] = []): KkResult<T> {
  const fixed: KkFix[] = [];
  const one = (s: string, style: boolean) => {
    const a = fixKkScript(s, ru);
    const r = fixRussianKk(a.text, ru);
    const b = style ? fixGrandkidsKk(r.text) : { text: r.text, fixed: [] };
    const c = applySpellingsKk(b.text, required);
    fixed.push(...a.fixed, ...r.fixed, ...b.fixed, ...c.fixed);
    return c.text;
  };
  const out = { ...raw, text_ko: one(raw.text_ko, true), title_ko: one(raw.title_ko, false), quote_ko: one(raw.quote_ko, false) };
  // цитата — та же фраза, что в тексте: если в тексте поправили обращение, правим и её
  for (const f of fixed) if (f.kind === "style") out.quote_ko = out.quote_ko.split(f.from).join(f.to);
  const all = [out.title_ko, out.text_ko, out.quote_ko].join("\n");
  const left = kkScriptLeft(all, ru);
  return { out, fixed, left: { ...left, style: grandkidsMixedKk(out.text_ko), russian: russianLeftKk(all, ru) } };
}

// ── 5. Повтор с замечанием (#313) ───────────────────────────────────────────

/** Сколько осталось не так (для выбора: первая попытка или повтор). Обращение к внукам — не повод для повтора. */
export function kkLeftCount(left: KkResult<Translated>["left"]): number {
  return left.latin.length + (left.hangul ? 1 : 0) + left.russian.length;
}

/**
 * Замечание к повтору перевода: что осталось после исправлений без ИИ. null — повтор не нужен.
 * Текст детерминирован (тот же остаток → тот же вход → тот же ключ кэша: повтор повтора бесплатен).
 */
export function kkRetryNote(left: KkResult<Translated>["left"]): string | null {
  const parts: string[] = [];
  if (left.hangul) parts.push("корейские буквы (хангыль)");
  if (left.latin.length) parts.push(`слова латиницей: ${left.latin.slice(0, 8).join(", ")}`);
  if (left.russian.length) parts.push(`русские слова: ${left.russian.slice(0, 10).join(", ")}`);
  if (!parts.length) return null;
  return (
    `В прошлой попытке перевода остались ${parts.join("; ")}. Переведи главу заново целиком по всем правилам: ` +
    "только казахская кириллица, без хангыля и латиницы; русские слова и вставки рассказчика — по-казахски " +
    "(кроме имён людей и советских реалий из глоссария); аббревиатуры — по-казахски (СССР → КСРО) или как в оригинале кириллицей."
  ).slice(0, 600);
}

/** Есть ли в готовом казахском тексте то, что ловит #298 (для repair-chapters): алфавит / обращение. */
export function kkProblems(t: { text: string | null; title?: string | null; quote?: string | null }, ru = ""): { script: string[]; style: StyleMix[] } {
  const all = [t.title ?? "", t.text ?? "", t.quote ?? ""].join("\n");
  const left = kkScriptLeft(all, ru);
  const fixable = fixKkScript(all, ru).fixed.map((f) => f.from);
  const script = [...new Set([...fixable, ...left.latin, ...(left.hangul ? ["хангыль"] : [])])];
  return { script, style: grandkidsMixedKk(t.text) };
}
