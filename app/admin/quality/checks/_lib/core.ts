// #353 (v2 Q2, docs/v2/QUALITY_LOOP.md §3.2, §4): чистая логика /review 2.0 и вкладки «Проверки».
// Без server-only и без node:* — модуль импортирует и клиентский экран проверяющего (подсветка слов, diff, прогресс).
import type { BookLang, ReviewAxis, ReviewRatings } from "@/lib/types";

/** text — целые тексты (абзацы, критерии, правка); terms — только выделенные фокус-слова. */
export type CheckKind = "text" | "terms";
export const CHECK_KINDS: readonly CheckKind[] = ["text", "terms"];
export function isCheckKind(v: unknown): v is CheckKind {
  return v === "text" || v === "terms";
}

/** Язык интерфейса проверяющего. Подписи — на нём и (если не ru) ещё по-русски. */
export type UiLang = "ru" | "ko" | "kk";
export const UI_LANGS: readonly UiLang[] = ["ko", "kk", "ru"];
export function isUiLang(v: unknown): v is UiLang {
  return v === "ru" || v === "ko" || v === "kk";
}

/** 5 критериев §4 в порядке экрана: смысл · естественность · обращение и регистр · имена и реалии · грамматика. */
export const CRITERIA: readonly ReviewAxis[] = ["meaning", "natural", "respect", "names", "grammar"];

/** Фокус-слово перевода: как написано в тексте + подсказка по-русски (что это должно значить). */
export interface FocusTerm {
  term: string;
  hint?: string;
}

/** Оценка фокус-слова: ok = true «верно», false «неверно» (+ как правильно), null — ещё не отвечено. */
export interface TermVerdict {
  ok: boolean | null;
  fix?: string | null;
}
export type TermVerdicts = Record<string, TermVerdict>;

export const TERMS_MIN = 3;
export const TERMS_MAX = 8;

// ---------------- фокус-слова: родство, обращения, реалии, даты ----------------

type Dict = readonly (readonly [term: string, hint: string])[];

// Корейский: подстрока (частицы пишутся слитно: 할머니는, 할머니께서). Длинные — раньше коротких (할아버지 ⊃ 아버지).
const KO_TERMS: Dict = [
  ["외할머니", "бабушка по матери"],
  ["외할아버지", "дедушка по матери"],
  ["할머니", "бабушка"],
  ["할아버지", "дедушка"],
  ["할마니", "бабушка (корё мар)"],
  ["아버님", "отец (почтительно)"],
  ["어머님", "мать (почтительно)"],
  ["아버지", "отец"],
  ["어머니", "мать"],
  ["오마니", "мама (корё мар)"],
  ["아바이", "отец / дед (корё мар)"],
  ["아빠", "папа"],
  ["엄마", "мама"],
  ["부모님", "родители"],
  ["오빠", "старший брат (для сестры)"],
  ["형님", "старший брат (почтительно)"],
  ["누나", "старшая сестра (для брата)"],
  ["언니", "старшая сестра (для сестры)"],
  ["남동생", "младший брат"],
  ["여동생", "младшая сестра"],
  ["동생", "младший брат / сестра"],
  ["손주들", "внуки"],
  ["손주", "внук / внучка"],
  ["손자", "внук"],
  ["손녀", "внучка"],
  ["삼촌", "дядя"],
  ["이모", "тётя по матери"],
  ["고모", "тётя по отцу"],
  ["남편", "муж"],
  ["아내", "жена"],
  ["너희들", "вы (к внукам)"],
  ["너희", "вы (к внукам)"],
  ["여러분", "вы все (вежливо)"],
  ["당신", "вы / ты"],
  ["소비에트 사회주의 공화국", "ССР"],
  ["소련", "СССР"],
  ["콜호스", "колхоз"],
  ["집단농장", "колхоз"],
  ["강제 이주", "депортация, переселение"],
  ["극동", "Дальний Восток"],
  ["우슈토베", "Уштобе"],
  ["타슈켄트", "Ташкент"],
  ["알마아타", "Алма-Ата"],
  ["블라디보스토크", "Владивосток"],
  ["포시예트", "Посьет"],
  ["연해주", "Приморье"],
  ["고려인", "корё-сарам"],
  ["고려 사람", "корё-сарам"],
  ["고려", "корё (корейцы СССР)"],
  ["국수", "кукси (лапша)"],
  ["김치", "кимчи"],
  ["아궁이", "печь"],
  ["동네", "улица, округа"],
  ["전쟁", "война"],
];

// Казахский: слово, которое НАЧИНАЕТСЯ с основы (окончания: әжеміз, апамның, сендерге). Короткие основы (≤ 3 букв)
// — только с короткими окончаниями, иначе «ана» ловит «анау», «сен» — «сенім».
const KK_TERMS: Dict = [
  ["нағашы", "родня по матери"],
  ["немере", "внук / внучка"],
  ["шөбере", "правнук"],
  ["әже", "бабушка"],
  ["ата", "дедушка"],
  ["әке", "отец"],
  ["ана", "мать"],
  ["апа", "мама / старшая (по региону)"],
  ["аға", "старший брат / дядя"],
  ["іні", "младший брат"],
  ["әпке", "старшая сестра"],
  ["қарындас", "младшая сестра (для брата)"],
  ["сіңлі", "младшая сестра (для сестры)"],
  ["жиен", "племянник по сестре / дочери"],
  ["жеңге", "жена старшего брата"],
  ["келін", "невестка"],
  ["күйеу", "муж / зять"],
  ["сендер", "вы (к внукам, на «ты»)"],
  ["сіздер", "вы (вежливо)"],
  ["сен", "ты"],
  ["сіз", "вы (вежливо)"],
  ["колхоз", "колхоз"],
  ["совхоз", "совхоз"],
  ["кеңес", "советский"],
  ["кср", "ССР"],
  ["ксро", "СССР"],
  ["соғыс", "война"],
  ["майдан", "фронт"],
  ["ауыл", "аул, село"],
  ["саман", "саман (глинобитный)"],
  ["ұштөбе", "Уштобе"],
  ["алматы", "Алматы"],
  ["қарағанды", "Караганда"],
  ["қарқаралы", "Каркаралинск"],
  ["кәріс", "корейцы"],
  ["орыс", "русские"],
  ["неміс", "немцы"],
  ["барақ", "барак"],
  ["асхана", "столовая"],
  ["бесбармақ", "бешбармак"],
  ["шахта", "шахта"],
];

// Казахский: обращение на «вы» по окончанию глагола (білесіздер, айтыңыздар) — к внукам по #298 нужно «сендер».
const KK_YOU = /^[\p{L}-]+(сіздер|сыздар|ңіздер|ңыздар)$/u;

const KIN_HINT = /(мат[ьи]|мама|отец|папа|брат|сестр|бабушк|дедушк|внук|внучк|родител|родня|дяд|тёт|муж|жена|невестк|племян|правнук|«вы»|^вы|^ты)/;

const KO_YEAR = /\d{4}년/g;
const KK_YEAR = /\d{4}(?:\s?ж\.|\s?жыл\p{L}*)?/gu;

/**
 * 3–8 фокус-слов в переводе по порядку появления (без повторов). extra — слова глоссария пакета (kk: KZ_GLOSSARY),
 * их ищем так же, как основы. Меньше 3 — для режима «слова» текст не годится (в форме — недоступен).
 */
export function detectFocusTerms(text: string, lang: BookLang, extra: Dict = []): FocusTerm[] {
  const found: { at: number; len: number; term: FocusTerm }[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  const push = (at: number, surface: string, hint: string) => {
    if (!free(at, at + surface.length)) return;
    taken.push([at, at + surface.length]);
    found.push({ at, len: surface.length, term: { term: surface, hint } });
  };

  if (lang === "ko") {
    const dict = [...KO_TERMS, ...extra].sort((a, b) => b[0].length - a[0].length);
    for (const [term, hint] of dict) {
      // первое свободное вхождение: 아버지 внутри 할아버지 уже занят — ищем дальше
      for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + 1)) {
        if (free(at, at + term.length)) {
          push(at, term, hint);
          break;
        }
      }
    }
    for (const m of text.matchAll(KO_YEAR)) push(m.index ?? 0, m[0], "дата");
  } else if (lang === "kk") {
    const dict = [...extra, ...KK_TERMS].sort((a, b) => b[0].length - a[0].length);
    const words = [...text.matchAll(/[\p{L}-]+/gu)].map((m) => ({ at: m.index ?? 0, w: m[0] }));
    for (const [stem, hint] of dict) {
      const s = stem.toLowerCase();
      const multi = s.includes(" ");
      if (multi) {
        const at = text.toLowerCase().indexOf(s);
        if (at >= 0) push(at, text.slice(at, at + s.length), hint);
        continue;
      }
      const hit = words.find(({ w }) => {
        const lw = w.toLowerCase();
        if (!lw.startsWith(s)) return false;
        const tail = lw.length - s.length;
        return s.length <= 3 ? tail <= 4 && !/^(у|ім|ау|ыс)/.test(lw.slice(s.length)) : tail <= 8;
      });
      if (hit) push(hit.at, hit.w, hint);
    }
    const you = words.find(({ w }) => KK_YOU.test(w.toLowerCase()));
    if (you) push(you.at, you.w, "обращение на «вы»");
    for (const m of text.matchAll(KK_YEAR)) push(m.index ?? 0, m[0].trim(), "дата");
  }
  // остальные языки (ru → ru не бывает) — без фокус-слов
  const uniq = new Set<string>();
  const distinct = found
    .sort((a, b) => a.at - b.at)
    .filter(({ term }) => {
      if (uniq.has(term.term)) return false;
      uniq.add(term.term);
      return true;
    });
  // больше 8 — оставляем сначала родство и обращения, потом реалии и места, даты — последними
  const prio = (t: FocusTerm) => (t.hint === "дата" ? 2 : KIN_HINT.test(t.hint ?? "") ? 0 : 1);
  const keep = new Set(
    [...distinct]
      .sort((a, b) => prio(a.term) - prio(b.term) || a.at - b.at)
      .slice(0, TERMS_MAX)
      .map((x) => x.term.term),
  );
  return distinct.filter((x) => keep.has(x.term.term)).map(({ term }) => term);
}

/** Текст перевода с отмеченными фокус-словами: каждое вхождение слова — с его номером. */
export function highlightSegments(text: string, terms: readonly FocusTerm[]): { text: string; term: number | null }[] {
  const marks: { at: number; end: number; term: number }[] = [];
  const order = terms.map((t, i) => ({ t: t.term, i })).filter((x) => x.t).sort((a, b) => b.t.length - a.t.length);
  for (const { t, i } of order) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(t, from);
      if (at < 0) break;
      const end = at + t.length;
      if (marks.every((m) => end <= m.at || at >= m.end)) marks.push({ at, end, term: i });
      from = end;
    }
  }
  marks.sort((a, b) => a.at - b.at);
  const out: { text: string; term: number | null }[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.at > pos) out.push({ text: text.slice(pos, m.at), term: null });
    out.push({ text: text.slice(m.at, m.end), term: m.term });
    pos = m.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), term: null });
  return out;
}

// ---------------- теги нюансов (фильтр материала, пока банк Q1 не в main) ----------------

export const NUANCE_TAGS = [
  "родство",
  "обращение к внукам",
  "даты и числа",
  "советские реалии",
  "корё мар",
  "казахские слова",
  "имена и места",
  "эмоции",
] as const;
export type NuanceTag = (typeof NUANCE_TAGS)[number];

const TAG_RULES: readonly [NuanceTag, RegExp][] = [
  ["родство", /(мам|мат[ьеи]|отц|отец|пап|бабушк|дед|брат|сестр|сын|доч|внук|внучк|тёт|тет[яи]|дяд|омани|аппади|хальмони|апа|әже)/i],
  ["обращение к внукам", /(внук|внучк|дети мои|вы, мои|ребята)/i],
  ["даты и числа", /\d/],
  ["советские реалии", /(СССР|ССР|колхоз|совхоз|фронт|войн|депорт|переселил|выслал|КГБ|ЗИЛ|трудармi?|парти[яи]|пионер|комсомол)/i],
  ["корё мар", /(омани|аппади|хальмони|кукси|чальтоги|хансик|ханмони|аба[йи]|корё)/i],
  ["казахские слова", /[әіңғүұқөһ]/i],
  ["имена и места", /(Уштобе|Ташкент|Алма|Владивосток|Посьет|Дальн\p{L}+ Восток|Караганд|Кзыл|Сырдарь|Талдык|Узбекистан|Казахстан)/u],
  ["эмоции", /(плак|слёз|слез|радост|страшн|страх|скуча|любил|горе|счастл|боял|обид)/i],
];

export function nuanceTags(source: string): NuanceTag[] {
  return TAG_RULES.filter(([, re]) => re.test(source)).map(([t]) => t);
}

// ---------------- правка абзаца: diff по словам ----------------

export type DiffOp = { op: "same" | "del" | "add"; text: string };

/** Diff двух строк по словам (пробелы — отдельные токены). Для показа «было → стало» после правки. */
export function wordDiff(before: string, after: string): DiffOp[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 4_000_000) return [{ op: "del", text: before }, { op: "add", text: after }];
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffOp[] = [];
  const push = (op: DiffOp["op"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push("del", a[i++]!);
    else push("add", b[j++]!);
  }
  while (i < n) push("del", a[i++]!);
  while (j < m) push("add", b[j++]!);
  return out;
}

// ---------------- прогресс: «N из M» ----------------

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export interface ProgressFeedback {
  paragraph: number;
  edited_text: string | null;
  ratings: ReviewRatings;
  comment: string | null;
  skipped: boolean;
  terms?: TermVerdicts;
}

export type ItemState = "empty" | "partial" | "done" | "skipped";

/**
 * Состояние текста для «N из M»: пропущен; готов — в режиме «текст» оценены все критерии ссылки,
 * в режиме «слова» отвечено про каждое фокус-слово; что-то начато — partial.
 */
export function itemState(
  kind: CheckKind,
  item: { id: string; targets: readonly string[]; termCount: number },
  feedback: readonly (ProgressFeedback & { item_id: string })[],
  criteria: readonly ReviewAxis[] = CRITERIA,
): ItemState {
  const mine = feedback.filter((f) => f.item_id === item.id);
  const whole = mine.find((f) => f.paragraph === -1);
  if (whole?.skipped) return "skipped";
  if (kind === "terms") {
    const answered = Object.values(whole?.terms ?? {}).filter((v) => v && typeof v.ok === "boolean").length;
    if (item.termCount > 0 && answered >= item.termCount) return "done";
    return answered > 0 || whole?.comment ? "partial" : "empty";
  }
  const rated = criteria.filter((c) => typeof whole?.ratings?.[c] === "number").length;
  if (rated === criteria.length) return "done";
  const edited = mine.some((f) => f.paragraph >= 0 && ((f.edited_text && norm(f.edited_text) !== norm(item.targets[f.paragraph] ?? "")) || f.comment));
  return rated > 0 || edited || whole?.comment ? "partial" : "empty";
}

export function progressCount(states: readonly ItemState[]): { done: number; total: number } {
  return { done: states.filter((s) => s === "done" || s === "skipped").length, total: states.length };
}

/** Фаза ссылки в таблице админки: открыта (ещё ничего) / в работе / готово (все тексты или «Готово» на итоге). */
export type LinkPhase = "open" | "work" | "done";
export function linkPhase(states: readonly ItemState[], completedAt: string | null | undefined): LinkPhase {
  const { done, total } = progressCount(states);
  if (completedAt || (total > 0 && done === total)) return "done";
  return states.some((s) => s !== "empty") ? "work" : "open";
}

/** Сколько займёт, минут: текст ≈ 1,5–2 мин, «слова» ≈ 0,5–1 мин на текст; не меньше 5. */
export function estimateMinutes(kind: CheckKind, items: number): [number, number] {
  const [lo, hi] = kind === "text" ? [1.5, 2] : [0.5, 1];
  const r = (x: number) => Math.max(5, Math.round((x * items) / 5) * 5);
  const a = r(lo);
  const b = Math.max(a + 5, r(hi));
  return [a, b];
}
