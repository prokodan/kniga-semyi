// #163: в корейском переводе не должно оставаться кириллицы («Ерлан», «ЗИЛ», «брига» на корейских страницах книги).
// Промпт велит транслитерировать имена (prompts/translate.ko.md), но модель иногда оставляет слово как есть.
// После перевода каждое кириллическое слово в text_ko / title_ko / quote_ko заменяем:
//   1) написанием из словаря семьи (одно имя — одно написание, #121 #124);
//   2) аббревиатуры (#197) — по смыслу, не по буквам: СССР → 소련, Казахская ССР → 카자흐 소비에트 사회주의 공화국,
//      КГБ → KGB; неизвестная аббревиатура ЗАГЛАВНЫМИ (2–5 букв) — латиницей (ГАИ → GAI), а не хангылем по буквам (스르);
//   3) иначе — транслитерацией по правилам записи русских слов хангылем (Уштобе → 우슈토베, Николай → 니콜라이).
// Чистые функции, без ИИ: повтор шага ничего не стоит.
import { sameEntity } from "./entities";
import type { NamePair, Translated } from "./names";

const VOWELS = "аеёиоуыэюя";
// индексы гласных хангыля: ㅏ0 ㅑ2 ㅔ5 ㅕ6 ㅖ7 ㅗ8 ㅛ12 ㅜ13 ㅠ17 ㅡ18 ㅣ20
const V: Record<string, number> = { а: 0, е: 5, ё: 12, и: 20, о: 8, у: 13, ы: 20, э: 5, ю: 17, я: 2 };
/** Йотированные в начале слова и после гласной / ь / ъ: е → 예, ё → 요, ю → 유, я → 야. */
const V_IOT: Record<string, number> = { е: 7, ё: 12, ю: 17, я: 2 };
// индексы начальных согласных: ㄱ0 ㄴ2 ㄷ3 ㄹ5 ㅁ6 ㅂ7 ㅅ9 ㅇ11 ㅈ12 ㅊ14 ㅋ15 ㅌ16 ㅍ17 ㅎ18
const L: Record<string, number> = {
  б: 7, в: 7, г: 0, д: 3, ж: 12, з: 12, к: 15, л: 5, м: 6, н: 2, п: 17, р: 5, с: 9, т: 16, ф: 17, х: 18, ц: 14, ч: 14, ш: 9, щ: 9,
};
/** Шипящие перед гласной смягчают её: ша → 샤, шу → 슈, ше → 셰 (ж, ч — без смягчения: жу → 주, ча → 차). */
const SOFTEN: Record<number, number> = { 0: 2, 5: 7, 8: 12, 13: 17 };
/** Согласная без гласной после себя — отдельный слог: б → 브, ш → 시 (в конце) / 슈 (перед согласной), ч → 치. */
const FINAL_VOWEL: Record<string, number> = { ш: 20, щ: 20, ч: 20 };
// индексы конечных: ㄴ4 ㄹ8 ㅁ16
const CODA: Record<string, number> = { л: 8, м: 16, н: 4 };

interface Syl {
  l: number;
  v: number;
  t: number;
}
const compose = (s: Syl) => String.fromCharCode(0xac00 + (s.l * 21 + s.v) * 28 + s.t);

/** Транслитерация одного русского слова (только кириллица, без дефиса) хангылем. */
export function hangulizeRu(word: string): string {
  const w = word.toLowerCase();
  const syl: Syl[] = [];
  let i = 0;
  const isVowel = (c: string | undefined) => c !== undefined && VOWELS.includes(c);
  while (i < w.length) {
    const c = w[i]!;
    const next = w[i + 1];
    if (c === "ь" || c === "ъ") {
      i++;
      continue;
    }
    if (isVowel(c)) {
      const prev = w[i - 1];
      const iot = i === 0 || isVowel(prev) || prev === "ь" || prev === "ъ";
      syl.push({ l: 11, v: iot && c in V_IOT ? V_IOT[c]! : V[c]!, t: 0 });
      i++;
      continue;
    }
    if (c === "й") {
      // после гласной — отдельный слог 이 (Николай → 니콜라이, Сергей → 세르게이); перед гласной — йотация
      if (isVowel(next)) {
        syl.push({ l: 11, v: V_IOT[next!] ?? (next === "о" ? 12 : next === "у" ? 17 : next === "а" ? 2 : 20), t: 0 });
        i += 2;
      } else {
        syl.push({ l: 11, v: 20, t: 0 });
        i++;
      }
      continue;
    }
    if (!(c in L)) {
      i++;
      continue;
    }
    if (next === c && c !== "л") {
      i++; // двойная согласная читается одной: Иссык → 이시크, Анна → 안나 (н даст кода ниже)
      if (c === "н" && syl.length && !syl[syl.length - 1]!.t) syl[syl.length - 1]!.t = CODA.н!;
      continue;
    }
    const soft = next === "ь" || next === "ъ";
    const after = soft ? w[i + 2] : next;
    const last = syl[syl.length - 1];
    // л перед гласной не в начале слова: удваивается (Николай → 니콜라이, Ерлан → 예를란, Володя → 볼로댜)
    if (isVowel(after) && c === "л" && last && !last.t) last.t = CODA.л!;
    if (soft && isVowel(after)) {
      // ь перед гласной: согласная + 이, гласная — йотированная (Татьяна → 타티야나, Наталья → 나탈리야)
      syl.push({ l: L[c]!, v: 20, t: 0 });
      i += 2;
      continue;
    }
    if (isVowel(after)) {
      let v = V[next!]!;
      if ((c === "ш" || c === "щ") && v in SOFTEN) v = SOFTEN[v]!;
      syl.push({ l: L[c]!, v, t: 0 });
      i += 2;
      continue;
    }
    // согласная в конце или перед согласной
    if (c in CODA && last && !last.t) {
      last.t = CODA[c]!;
    } else if (c === "ш" || c === "щ") {
      syl.push({ l: 9, v: after === undefined ? 20 : 17, t: 0 }); // в конце 시, перед согласной 슈 (Уштобе → 우슈토베)
    } else {
      // в без гласной оглушается: Петров → 페트로프
      syl.push({ l: c === "в" ? 17 : L[c]!, v: FINAL_VOWEL[c] ?? 18, t: 0 });
    }
    i++;
  }
  return syl.map(compose).join("");
}

// ── #197 аббревиатуры ────────────────────────────────────────────────────────

const SSR_KO = "소비에트 사회주의 공화국";
/** Республики по основе прилагательного (Казахская / Казахской ССР) и по сокращению (КазССР). */
const REPUBLICS: { stem: string; short: string[]; ko: string }[] = [
  { stem: "казах", short: ["Каз"], ko: "카자흐" },
  { stem: "узбек", short: ["Уз"], ko: "우즈베크" },
  { stem: "кирги", short: ["Кирг", "Кир"], ko: "키르기스" },
  { stem: "таджик", short: ["Тадж", "Тад"], ko: "타지크" },
  { stem: "туркмен", short: ["Туркм", "Тур"], ko: "투르크멘" },
  { stem: "украин", short: ["Укр"], ko: "우크라이나" },
  { stem: "белорус", short: ["Бел", "Б"], ko: "벨라루스" },
];
/** Известные аббревиатуры (ключ — заглавными). ЗИЛ читается словом — 질, как раньше (#163). */
const ABBR: Record<string, string> = {
  СССР: "소련",
  ССР: SSR_KO,
  КГБ: "KGB",
  ЗИЛ: "질",
  ...Object.fromEntries(REPUBLICS.flatMap((r) => r.short.map((s) => [`${s}ССР`.toUpperCase(), `${r.ko} ${SSR_KO}`]))),
};
/** Частица сразу после кириллицы (без пробела) — её согласуем с новым словом, см. fitParticle. */
const PARTICLE = "(으로|로|을|를|은|는|가|이|과|와)?";
/** «Казахская ССР», «Узбекской ССР» — прилагательное с аббревиатурой одной фразой. */
const REPUBLIC_PHRASE = new RegExp(`(?<![А-Яа-яЁё])(${REPUBLICS.map((r) => r.stem).join("|")})[а-яё]*\\s+ССР(?![А-Яа-яЁё])${PARTICLE}`, "giu");

const LAT: Record<string, string> = {
  а: "A", б: "B", в: "V", г: "G", д: "D", е: "E", ё: "YO", ж: "ZH", з: "Z", и: "I", й: "Y", к: "K", л: "L", м: "M", н: "N",
  о: "O", п: "P", р: "R", с: "S", т: "T", у: "U", ф: "F", х: "KH", ц: "TS", ч: "CH", ш: "SH", щ: "SHCH", ъ: "", ы: "Y", ь: "",
  э: "E", ю: "YU", я: "YA",
};
/** Аббревиатура латиницей: ГАИ → GAI, МТС → MTS. */
export const latinizeAbbr = (word: string) => [...word.toLowerCase()].map((c) => LAT[c] ?? "").join("");
const isAbbr = (word: string) => /^[А-ЯЁ]{2,5}$/.test(word);

/** Корейское написание аббревиатуры или null, если слово — не аббревиатура. */
export function abbrKo(word: string): string | null {
  const known = ABBR[word.toUpperCase()];
  // «ССР» / «КазССР» узнаём и в смешанном регистре; прочие — только ЗАГЛАВНЫМИ (иначе «Каз», «зил» — обычные слова)
  if (known && (isAbbr(word) || /ССР$/.test(word))) return known;
  return isAbbr(word) ? latinizeAbbr(word) : null;
}

/** Кириллическое слово (возможно, через дефис: Иссык-Куль, Ким-Ли) и частица сразу после него. */
const CYR_WORD = /([А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*)(으로|로|을|를|은|는|가|이|과|와)?/g;

/**
 * Частица под новое слово: модель ставила её под своё «чтение» кириллицы («СССР를»), а 소련 оканчивается на согласную →
 * 소련을. Только для хангыля в конце (KGB, GAI не трогаем); 이 после гласной не меняем — это может быть связка (이었다).
 */
export function fitParticle(word: string, particle: string | undefined): string {
  if (!particle) return "";
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code >= 11172) return particle;
  const t = code % 28;
  switch (particle) {
    case "을":
    case "를":
      return t ? "을" : "를";
    case "은":
    case "는":
      return t ? "은" : "는";
    case "과":
    case "와":
      return t ? "과" : "와";
    case "가":
      return t ? "이" : "가";
    case "로":
    case "으로":
      return t && t !== 8 ? "으로" : "로"; // ㄹ в конце — 로 (서울로)
    default:
      return particle;
  }
}

export interface CyrillicFix {
  from: string;
  to: string;
  /** dict — из словаря семьи; abbr — аббревиатура (#197); translit — транслитерация */
  how: "dict" | "abbr" | "translit";
}

const note = (fixes: CyrillicFix[], fix: CyrillicFix) => {
  if (!fixes.some((f) => f.from === fix.from)) fixes.push(fix);
};

/** Заменить кириллицу в одном тексте. */
export function replaceCyrillic(text: string, dict: NamePair[], fixes: CyrillicFix[]): string {
  if (!text || !/[А-Яа-яЁё]/.test(text)) return text;
  // #197: сначала фразы «Казахская ССР» — иначе прилагательное ушло бы в транслитерацию (카자흐스카야)
  const phrased = text.replace(REPUBLIC_PHRASE, (phrase: string, stem: string, particle?: string) => {
    const r = REPUBLICS.find((x) => x.stem === stem.toLowerCase())!;
    const to = `${r.ko} ${SSR_KO}`;
    const from = particle ? phrase.slice(0, -particle.length) : phrase;
    note(fixes, { from, to, how: "abbr" });
    return to + fitParticle(to, particle);
  });
  return phrased.replace(CYR_WORD, (all: string, word: string, particle?: string) => {
    const hit = dict.find((p) => sameEntity(p.ru, word));
    const abbr = hit || word.includes("-") ? null : abbrKo(word);
    const to = hit ? hit.ko : (abbr ?? word.split("-").map(hangulizeRu).join(""));
    if (!to) return all;
    note(fixes, { from: word, to, how: hit ? "dict" : abbr ? "abbr" : "translit" });
    return to + fitParticle(to, particle);
  });
}

/** Перевод главы без кириллицы: text_ko / title_ko / quote_ko. */
export function fixCyrillic<T extends Translated>(out: T, dict: NamePair[]): { out: T; fixed: CyrillicFix[] } {
  const fixed: CyrillicFix[] = [];
  const res = {
    ...out,
    text_ko: replaceCyrillic(out.text_ko, dict, fixed),
    title_ko: replaceCyrillic(out.title_ko, dict, fixed),
    quote_ko: replaceCyrillic(out.quote_ko, dict, fixed),
  };
  return { out: res, fixed };
}

/** Есть ли в корейском тексте главы кириллица (для repair-chapters и проверок). */
export const hasCyrillic = (...texts: (string | null | undefined)[]) => texts.some((t) => /[А-Яа-яЁё]/.test(t ?? ""));
