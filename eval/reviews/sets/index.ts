// #232: наборы вымышленных глав для ссылок носителей (/admin/reviews → «набор: прогон eval»).
// Файл набора пишет прогон eval: `npm run eval -- --personas kim,pak --review-set eval/reviews/sets/<имя>.json`
// (AI_MODE=gemini — иначе в наборе ответы заглушки). Затем — строка импорта ниже. Только eval-персонажи
// (eval/personas/*.md): тест app/admin/reviews/_lib/sets.test.ts падает, если в наборе не персонаж eval.
import type { ReviewSetFile } from "../format";
// #257: прогон eval 27.11 (Actions → eval, gemini-3.5-flash-lite): kim, pak, tsoi — ru → ko; serik — ru → kk
import ruKo20261127 from "./2026-11-27-ru-ko.json";
import ruKk20261127 from "./2026-11-27-ru-kk.json";

export const REVIEW_EVAL_SETS: readonly ReviewSetFile[] = [ruKo20261127, ruKk20261127];
