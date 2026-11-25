import "server-only";
// Словарь имён семьи (#104): сервис с настоящим хранилищем и перевод затронутых глав через конвейер.
import { markBookOutdated } from "@/lib/book/build";
import { runStep, type StepResult } from "@/lib/pipeline";
import { getEntityRepo } from "./repo";
import { createEntityService } from "./service";

export { EntityError, type ChapterText, type EntityChange } from "./service";

export function entityService() {
  return createEntityService({ repo: getEntityRepo(), markBookOutdated });
}

/**
 * Новый перевод одной главы после замены имени (шаг translate конвейера) и, если перевод готов,
 * поправка корейского написания. ИИ занят → queued: перевод доведут экран главы или kick-stuck
 * (тогда поправка KR не применится — см. заметки PR #104).
 */
export async function retranslateChapter(familyId: string, storyId: string, koFix: { from: string; to: string } | null): Promise<StepResult> {
  const res = await runStep(storyId, "translate");
  if (res.done && koFix) await entityService().fixKorean(familyId, storyId, koFix);
  return res;
}
