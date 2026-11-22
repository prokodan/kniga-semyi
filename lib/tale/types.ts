// Сказка для внуков (I8): общие типы и правила — без server-only, их видит и страница-книжка.

/** Единый стиль всех картинок сказки: одна строка на все вызовы illustrate. */
export const TALE_STYLE =
  "soft watercolor children's book illustration, warm paper texture, gentle warm colors, " +
  "simple kind faces with small dot eyes, rounded friendly shapes, no text, no letters, no words on the picture";

/** Сколько глав берём в сказку: минимум и максимум. */
export const TALE_MIN_STORIES = 2;
export const TALE_MAX_STORIES = 5;
/** Сколько страниц (и картинок) оставляем: промпт просит 4, модель может дать больше. */
export const TALE_MAX_PAGES = 4;

export type TaleStatus = "none" | "writing" | "ready" | "failed";

export interface TalePageView {
  text: string;
  /** Ссылка на картинку (подписанная или data:) — null, пока не нарисована */
  image: string | null;
  /** Картинку не удалось нарисовать — можно попробовать ещё раз */
  imageError: string | null;
  /** Картинка из готового набора (художник был недоступен) — можно нарисовать свою */
  fallback: boolean;
}

export interface TaleView {
  status: TaleStatus;
  title: string | null;
  childName: string | null;
  storytellerName: string | null;
  pages: TalePageView[];
  /** Сколько картинок готово из pages.length */
  illustrated: number;
  /** Сколько готовых глав у семьи сейчас (для «нужно ещё N») */
  storiesReady: number;
  error: string | null;
  updatedAt: string | null;
}
