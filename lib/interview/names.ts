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
  for (const f of src.facts ?? []) if (f.type === "person" || f.type === "place") add(f.value);
  add(src.familyName?.replace(/^семья\s+/i, ""));
  return out;
}

/** Все подсказки: семья → топонимы → фамилии → корё мар, без повторов, не больше 120. */
export function nameHints(src: NameHintSource): string[] {
  const all = [...familyHints(src), ...GLOSSARY_PLACES, ...GLOSSARY_SURNAMES, ...GLOSSARY_KORYO];
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
