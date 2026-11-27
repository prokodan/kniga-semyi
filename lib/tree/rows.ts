// #277: подписи рядов древа — от того, чью книгу смотрят (rel: −1 родители, 0 его ряд, 1 дети).
// Второй язык — по языкам книги: ko — корейский, kk — казахский (казахский носителем не проверен, #232).
export type RowLang = "ko" | "kk" | null;

const RU: Record<string, string> = {
  "-4": "Предки",
  "-3": "Прадеды",
  "-2": "Бабушки и дедушки",
  "-1": "Родители",
  "0": "Рассказчик и семья",
  "1": "Дети",
  "2": "Внуки",
  "3": "Правнуки",
  "4": "Праправнуки",
};
const KO: Record<string, string> = { "-3": "증조부모", "-2": "조부모", "-1": "부모", "1": "자녀", "2": "손주", "3": "증손주" };
const KK: Record<string, string> = { "-2": "Ата-әже", "-1": "Ата-ана", "1": "Балалар", "2": "Немерелер", "3": "Шөберелер" };

export interface RowTitle {
  ru: string;
  second: string | null;
  lang: RowLang;
}

export function rowTitle(rel: number | null, lang: RowLang = null, viewerFemale = false): RowTitle | null {
  if (rel === null) return null;
  const k = String(Math.max(-4, Math.min(4, rel)));
  const ru = rel === 0 && viewerFemale ? "Рассказчица и семья" : RU[k]!;
  const second = lang === "ko" ? (KO[k] ?? null) : lang === "kk" ? (KK[k] ?? null) : null;
  return { ru, second, lang: second ? lang : null };
}

/** Второй язык подписей по языкам книги: ru + ko → ko, ru + kk → kk, только ru → нет. */
export function rowLang(langs: readonly string[]): RowLang {
  if (langs.includes("ko")) return "ko";
  if (langs.includes("kk")) return "kk";
  return null;
}
