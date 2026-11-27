// #232: наборы вымышленных глав для ссылок носителей (/admin/reviews → «набор: прогон eval»).
// Файл набора пишет прогон eval: `npm run eval -- --personas kim,pak --review-set eval/reviews/sets/<имя>.json`
// (AI_MODE=gemini — иначе в наборе ответы заглушки). Затем — строка импорта ниже. Только eval-персонажи
// (eval/personas/*.md): тест app/admin/reviews/_lib/sets.test.ts падает, если в наборе не персонаж eval.
import type { ReviewSetFile } from "../format";

export const REVIEW_EVAL_SETS: readonly ReviewSetFile[] = [];
