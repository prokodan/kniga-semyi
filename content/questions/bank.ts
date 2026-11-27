import { resolveBank } from "@/content/packs";
import { DEFAULT_CULTURE_PACKS, type Question } from "@/lib/types";

// Банк вопросов V0: 8 блоков карты жизни × 5 вопросов, RU + KR, свой «минимум полноты» у каждого.
// id = "<block>-<NN>", порядок внутри блока = порядок показа (от лёгкого к личному).
//
// #230: тексты переехали в культурные пакеты — content/packs/general (костяк) + content/packs/koryo (слой корё-сарам).
// QUESTIONS = банк по умолчанию (general + koryo, рассказ по-русски) — ровно то, что семьи слышали до v2
// (тест content/packs/index.test.ts сверяет со снимком content/packs/bank-v0.snapshot.json).
// Банк конкретной семьи по её culture_packs / spoken_langs — resolveBank из content/packs (включается флагами L1 / P / S).
//
// Для кого: корё-сарам 70–90 лет, говорят в основном по-русски. Поэтому:
// — на «вы», простыми словами, одна мысль в вопросе;
// — корейский: вежливый 해요체 с почтительным -시-, без сложной лексики (это видит комиссия АКНЦ);
// — трудные темы (война, переселение, потери) — только в hardship и не первыми,
//   с прямым разрешением не отвечать.
// minimum — что должно прозвучать в ответе; интервью-агент (I10) уточняет только недостающее.
// Шпаргалка для проверки корейского человеком: content/questions/ko-review.md (тест сверяет её с банком).
export const QUESTIONS: Question[] = resolveBank(DEFAULT_CULTURE_PACKS, "ru");
