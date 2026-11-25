// Имена и топонимы (пункт 5): подсказки для расшифровки и редактуры + поиск неуверенно распознанного
// имени или места, чтобы один раз переспросить («Правильно ли я поняла: Уштобе?»).
// Источники подсказок: словарь docs/glossary.md (корё мар, топонимы, фамилии — список ниже, тест сверяет
// его с файлом), карточка рассказчика (имя, место рождения), люди и места, уже названные в прошлых главах.
// Чистые функции без базы и ИИ.
import type { StoryFact } from "@/lib/types";

/** Топонимы из docs/glossary.md в основной форме (в словаре — основа со «*»). */
export const GLOSSARY_PLACES = [
  "Уштобе", "Бастобе", "Кзыл-Орда", "Кызылорда", "Алматы", "Алма-Ата", "Ташкент", "Талдыкорган", "Караганда",
  "Каратал", "Шымкент", "Чимкент", "Бишкек", "Владивосток", "Хабаровск", "Сахалин", "Приморье", "Дальний Восток",
  "Казахстан", "Узбекистан", "Москва",
] as const;

/** Корейские фамилии из docs/glossary.md */
export const GLOSSARY_SURNAMES = [
  "Ким", "Ли", "Пак", "Цой", "Цхай", "Тен", "Тён", "Хван", "Нам", "Ан", "Шин", "Шен", "Хан", "Тян", "Тягай", "Юн", "Мун",
  "Огай", "Хегай", "Югай", "Когай", "Лигай",
] as const;

/** Слова корё мар из docs/glossary.md (первый вариант написания + частые). */
export const GLOSSARY_KORYO = [
  "кукси", "чимчи", "кимчи", "пигоди", "хансик", "ханщи", "асянди", "хвангаб", "аппади", "омани", "хальмони", "харабоджи",
  "харабай", "чальтоги", "хе", "панчан", "пап", "тенджан", "кочжан", "кадича", "сирэги", "чеса", "кхынсан", "аджимай",
  "аджибай", "морковча", "корё мар", "корё-сарам",
] as const;

export interface NameHintSource {
  storytellerName?: string | null;
  birthPlace?: string | null;
  familyName?: string | null;
  /** Факты прошлых глав этого рассказчика */
  facts?: Pick<StoryFact, "type" | "value">[];
  /** #102: словарь семьи (family_entities, уже по важности) — самые надёжные подсказки, идут первыми */
  entities?: string[];
}

const MAX_HINTS = 120;

/** Имена и места, которые уже знаем про эту семью (карточка + прошлые главы) — самые важные подсказки. */
export function familyHints(src: NameHintSource): string[] {
  const out: string[] = [];
  const add = (v: string | null | undefined) => {
    for (const part of (v ?? "").split(/[,;]/)) {
      const t = part.replace(/[«»"()]/g, "").trim();
      if (t.length >= 2 && t.length <= 60 && !out.includes(t)) out.push(t);
    }
  };
  add(src.storytellerName);
  add(src.birthPlace);
  for (const e of (src.entities ?? []).slice(0, 60)) add(e);
  for (const f of src.facts ?? []) if (f.type === "person" || f.type === "place") add(f.value);
  add(src.familyName?.replace(/^семья\s+/i, ""));
  return out;
}

/**
 * Все подсказки: семья (карточка → словарь семьи → прошлые главы) → корё мар → топонимы → фамилии, без повторов,
 * не больше 120. #102: корё мар раньше топонимов — модели расшифровки берут только первые 45–60, и слова
 * корё мар («пигоди», «кочжан») до них не доходили.
 */
export function nameHints(src: NameHintSource): string[] {
  const all = [...familyHints(src), ...GLOSSARY_KORYO, ...GLOSSARY_PLACES, ...GLOSSARY_SURNAMES];
  return [...new Set(all)].slice(0, MAX_HINTS);
}

/** Короткая строка для prompt gpt-4o-transcribe (ограничен ~200 токенами): семья и места первыми. */
export function hintsLine(hints: string[], max = 45): string {
  return hints.slice(0, max).join(", ");
}

// ---------------- Неуверенно распознанное имя / место ----------------

const yo = (s: string) => s.toLowerCase().replace(/ё/g, "е");

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Та же основа с другим окончанием («Караганде» ↔ «Караганда») — не ошибка распознавания. */
function sameStem(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 4) return false;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= Math.max(a.length, b.length) - 2;
}

export interface UncertainName {
  /** Как записано в расшифровке («У штабе») */
  heard: string;
  /** Что, вероятно, сказано («Уштобе») */
  guess: string;
}

/**
 * Первое место, где слово (или два слова подряд, склеенные) почти совпадает с подсказкой, но не равно ей:
 * «У штабе» ≈ «Уштобе». Только люди и места длиной ≥ 5 букв (короткие фамилии дают ложные совпадения).
 */
export function findUncertain(text: string, hints: string[]): UncertainName | null {
  const words = [...text.matchAll(/[А-Яа-яЁё][А-Яа-яЁё-]*/g)].map((m) => ({ w: m[0], i: m.index! }));
  const parts = [...new Set(hints.flatMap((h) => h.split(/\s+/)))];
  const targets = parts.filter((h) => /^[А-ЯЁ]/.test(h) && h.replace(/-/g, "").length >= 5);
  let best: (UncertainName & { d: number }) | null = null;
  for (const h of targets) {
    const H = yo(h);
    const maxD = H.length >= 8 ? 2 : 1;
    for (let k = 0; k < words.length; k++) {
      for (const n of [1, 2]) {
        if (k + n > words.length) continue;
        const span = words.slice(k, k + n);
        const joined = yo(span.map((s) => s.w).join(""));
        if (joined[0] !== H[0]) continue;
        if (joined === H || sameStem(joined, H)) continue;
        if (n === 1 && /^[а-яё]/.test(span[0]!.w)) continue; // одно слово со строчной — обычное слово, не имя
        const d = levenshtein(joined, H);
        if (d > maxD) continue;
        const heard = text.slice(span[0]!.i, span[n - 1]!.i + span[n - 1]!.w.length);
        if (!best || d < best.d) best = { heard, guess: h, d };
      }
    }
  }
  return best ? { heard: best.heard, guess: best.guess } : null;
}

const YES = /^(да|ага|угу|так|верно|правильно|точно|конечно|да-да)(?![а-яё])/i;
const NO = /(^|[\s,.!])(нет|не\s+так|неправильно|не\s+то)(?![а-яё])/i;
const STOP = new Set(["нет", "да", "так", "правильно", "верно", "это", "было", "там", "мы", "я", "вы", "не", "а", "в", "на", "и", "город", "село", "место", "называется", "назывался", "называлось"]);

/**
 * Ответ на «Правильно ли я поняла: Уштобе?» → какое написание оставить. Сравниваем с первым вариантом:
 * «да» или похожее на guess слово → guess; «нет, Бастобе» → названное слово; непонятно → guess (он из словаря
 * или карточки — контекст за него).
 */
export function resolveName(answer: string, c: UncertainName): string {
  const a = answer.trim();
  const words = [...a.matchAll(/[А-Яа-яЁё][А-Яа-яЁё-]*/g)].map((m) => m[0]);
  const G = yo(c.guess);
  const close = words.find((w) => levenshtein(yo(w), G) <= 2 || sameStem(yo(w), G));
  if (YES.test(a) && !NO.test(a)) return close && yo(close) !== G && !sameStem(yo(close), G) ? close : c.guess;
  if (close) return c.guess;
  if (NO.test(a)) {
    const named = words.filter((w) => w.length >= 3 && !STOP.has(yo(w)));
    const cap = named.find((w) => /^[А-ЯЁ]/.test(w)) ?? named[0];
    if (cap) return cap[0]!.toUpperCase() + cap.slice(1);
  }
  return c.guess;
}

/** Заменить все вхождения «как услышали» на выбранное написание (пробелы внутри — любые). */
export function applyName(text: string, heard: string, chosen: string): string {
  if (!heard || heard === chosen) return text;
  const re = new RegExp(heard.split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
  return text.replace(re, chosen);
}

// ---------------- Сверка расшифровки со словарём (#102) ----------------

/**
 * Звучание для сравнения: ё→е, безударные а/о и е/и/я неразличимы на слух, звонкие → глухие, «чж/дж» → «ч»,
 * без ь/ъ и двойных букв. «опаса уле» и «апа Сауле» звучат одинаково.
 */
export function soundKey(s: string): string {
  let t = yo(s).replace(/[^а-я]/g, "");
  t = t.replace(/[чд]ж/g, "ч").replace(/тс|тьс|дс/g, "ц");
  const map: Record<string, string> = { о: "а", я: "а", е: "и", э: "и", ы: "и", ю: "у", б: "п", в: "ф", г: "к", д: "т", ж: "ш", з: "с", щ: "ш", й: "и" };
  t = [...t].map((c) => map[c] ?? c).join("").replace(/[ьъ]/g, "");
  return t.replace(/(.)\1+/g, "$1");
}

/** Слова корё мар, похожие на обычные русские («морковча» ↔ «морковка») — по одному слову не исправляем. */
const NO_FUZZY = new Set(["морковча", "пап", "хе", "чеса", "кимчи", "корё мар", "корё-сарам", "хан", "ан", "нам", "мун", "юн"]);
/** Русские слова, звучащие как слово корё мар («кочан капусты» ≠ «кочжан»), — не трогаем. */
const DECOYS = /^(кочан|кочна|кочне|кочну|морковк|папа|папу|папе)/;
/**
 * #168: обычные русские слова (и их разговорные формы — «мамо», «папо») сверка не трогает никогда: ни как
 * «услышанное» слово, ни как цель из подсказок (словарь семьи мог подхватить «мамо» из расшифровки как слово
 * корё мар). Сверка — только для имён, мест и слов корё мар.
 */
const COMMON_RU =
  /^(мам[аыеуо]|мамой|мамочк\p{L}*|пап[аыеуо]|папой|папочк\p{L}*|дом|дом[аеуы]|домом|дома[мх]и?|бабушк\p{L}*|дедушк\p{L}*|брат\p{L}{0,3}|сестр\p{L}{0,3}|отец|отц\p{L}{0,3}|мать|матер\p{L}{0,3}|сын\p{L}{0,4}|доч\p{L}{0,4}|жен[аеуыо]|женой|муж\p{L}{0,3}|тет[яиеюь]\p{L}{0,2}|дяд[яиеюь]\p{L}{0,2}|школ\p{L}{0,3}|работ\p{L}{0,3}|город\p{L}{0,3}|войн\p{L}{0,2}|семь[яиеюё]\p{L}{0,2})$/u;
export const isCommonWord = (w: string) => COMMON_RU.test(yo(w));

/** Основа без падежного окончания — «Караганде» и «Караганда» одно слово. */
const stem = (s: string) => yo(s).replace(/(ами|ями|ом|ем|ой|ей|ую|юю|[аеиоуыяюй])$/u, "");

export interface NameFix {
  heard: string;
  fixed: string;
}

/**
 * Сверка после расшифровки: слово или два слова подряд, которые звучат как имя, место или слово корё мар из
 * подсказок (словарь семьи, карточка, глоссарий), но записаны иначе, — заменить написанием из подсказок.
 * «опаса уле» → «апа Сауле», «кончана» → «кочжана», «Уштабе» → «Уштобе». Окончание слова сохраняется.
 * Только уверенные случаи: звучание совпадает (≤ 1 отличие для длинных), цель одна, имя с заглавной — только
 * для слова с заглавной. Неуверенные остаются как есть — их переспрашивает интервью (#87, findUncertain).
 */
export function reconcileNames(text: string, hints: string[]): { text: string; fixes: NameFix[] } {
  const targets = [...new Set(hints.map((h) => h.trim()).filter((h) => h.length >= 4 && !NO_FUZZY.has(yo(h)) && !isCommonWord(h)))]
    .map((h) => ({ h, key: soundKey(h), cap: /^[А-ЯЁ]/.test(h), words: h.split(/\s+/).length }))
    .filter((t) => t.key.length >= 4 && t.words <= 2);
  const tokens = [...text.matchAll(/[А-Яа-яЁё][А-Яа-яЁё-]*/g)].map((m) => ({ w: m[0], i: m.index! }));
  const fixes: (NameFix & { start: number; end: number })[] = [];
  const exact = new Set(targets.map((t) => yo(t.h)));
  const stems = new Set(targets.map((t) => stem(t.h)));
  for (let k = 0; k < tokens.length; k++) {
    if (fixes.some((f) => tokens[k]!.i < f.end)) continue; // уже занято предыдущей заменой
    let done = false;
    for (const n of [2, 1]) {
      if (done || k + n > tokens.length) continue;
      const span = tokens.slice(k, k + n);
      // два слова — только через пробел (не через знаки препинания)
      if (n === 2 && !/^\s+$/.test(text.slice(span[0]!.i + span[0]!.w.length, span[1]!.i))) continue;
      const raw = span.map((s) => s.w).join(n === 2 ? " " : "");
      if (exact.has(yo(raw)) || (n === 1 && (stems.has(stem(raw)) || DECOYS.test(yo(raw))))) continue;
      if (span.some((t) => isCommonWord(t.w))) continue; // #168: «мама», «папа», «дом» — не имя и не корё мар
      const sentenceStart = k === 0 || /[.!?…]["»]?\s*$/.test(text.slice(0, span[0]!.i));
      const cands: { t: (typeof targets)[number]; suffix: string; d: number }[] = [];
      for (const t of targets) {
        if (t.cap && !/^[А-ЯЁ]/.test(span[0]!.w)) continue; // имя — только если слово с заглавной
        if (!t.cap && n === 1 && /^[А-ЯЁ]/.test(span[0]!.w) && !sentenceStart) continue; // слово корё мар не путаем с именем
        if (t.words === 2 && n === 1) continue;
        // окончание: «кончана» = «кочжан» + «а»
        for (const sl of [0, 1, 2]) {
          const last = span[n - 1]!.w;
          if (sl >= last.length - 1) continue;
          const suffix = sl ? last.slice(-sl) : "";
          if (suffix && !/^[аеиоуыяюйм]+$/i.test(suffix)) continue;
          const body = raw.slice(0, raw.length - sl);
          const key = soundKey(body);
          if (key[0] !== t.key[0]) continue;
          const d = levenshtein(key, t.key);
          // Строго, чтобы не портить обычные слова («бегали» ≠ «пигоди», «погоди» ≠ «пигоди»):
          // два слова и слово корё мар — только полное совпадение звучания; имя с заглавной — ≤ 1 отличие
          // для длинных (≥ 6 звуков) и та же первая буква.
          if (n === 1 && (yo(raw)[0] !== yo(t.h)[0] || t.key.length < 5)) continue; // «Лина» ≠ «Лена»: короткие имена не трогаем
          const max = n === 1 && t.cap && t.key.length >= 6 ? 1 : 0;
          if (d <= max) cands.push({ t, suffix, d });
        }
      }
      if (cands.length === 0) continue;
      cands.sort((a, b) => a.d - b.d || a.suffix.length - b.suffix.length);
      const best = cands[0]!;
      if (cands.some((c) => c.t.h !== best.t.h && c.d === best.d)) continue; // две разные цели — не уверены
      let fixed = best.t.h + best.suffix;
      if (!best.t.cap && sentenceStart && /^[А-ЯЁ]/.test(span[0]!.w)) fixed = fixed[0]!.toUpperCase() + fixed.slice(1);
      if (yo(fixed) === yo(raw)) continue;
      const start = span[0]!.i;
      const end = span[n - 1]!.i + span[n - 1]!.w.length;
      fixes.push({ heard: text.slice(start, end), fixed, start, end });
      done = true;
    }
  }
  let out = text;
  for (const f of [...fixes].sort((a, b) => b.start - a.start)) out = out.slice(0, f.start) + f.fixed + out.slice(f.end);
  return { text: out, fixes: fixes.map(({ heard, fixed }) => ({ heard, fixed })) };
}
