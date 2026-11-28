import "server-only";
// Словарь имён семьи (#104): сервис с настоящим хранилищем и перевод затронутых глав через конвейер.
import { markBookOutdated } from "@/lib/book/build";
import { dropStaleTranslations, runStep, type StepResult } from "@/lib/pipeline";
import { getEntityRepo } from "./repo";
import { createEntityService } from "./service";

export { EntityError, type ChapterText, type EntityChange, type EntityOptions, type EntityRow } from "./service";

export function entityService() {
  return createEntityService({ repo: getEntityRepo(), markBookOutdated, dropTranslations: dropStaleTranslations });
}

/**
 * Новый перевод одной главы после замены имени (шаг translate конвейера) и, если перевод готов,
 * поправка корейского написания. ИИ занят → queued: перевод доведут экран главы или kick-stuck
 * (тогда поправка KR не применится — см. заметки PR #104).
 * #305 / #311: `any` — книга без корейского (RU + KZ, только RU): следующий нужный шаг по данным, а не строго translate —
 * у «только RU» перевода нет вовсе (глава сразу ready), у RU + KZ это перевод kk. Книга RU + KR — как было.
 */
export async function retranslateChapter(
  familyId: string,
  storyId: string,
  koFix: { from: string; to: string } | null,
  opts: { any?: boolean } = {},
): Promise<StepResult> {
  const res = opts.any ? await runStep(storyId) : await runStep(storyId, "translate");
  if (res.done && koFix) await entityService().fixKorean(familyId, storyId, koFix);
  return res;
}
