import "server-only";
// #320 (флаг followup_addition): плашка «Есть новое дополнение — пересобрать?» на /chapter/<id> и /draft/<id>.
// Подключается одной строкой: <AdditionBanner story={story} token={token} place="chapter" />. Сама читает флаг
// (labs семьи) и отметку правки семьи (#149, story_texts.origin = family). Нет флага / отметки — ничего не рисует.
import { getDbOrNull } from "@/lib/db";
import { flag } from "@/lib/flags";
import { familyEditedIn } from "@/lib/interview/edited";
import type { Story } from "@/lib/types";
import { additionView } from "./addition";
import { AdditionBannerClient } from "./AdditionBannerClient";

export async function AdditionBanner({ story, token, place }: { story: Story; token: string; place: "chapter" | "draft" }) {
  if (!story.addition_pending || story.status !== "ready") return null; // частый случай — без запросов
  const db = getDbOrNull();
  let labs: string[] | null = null;
  let edited = false;
  if (db) {
    try {
      const [fam, ed] = await Promise.all([
        db.from("families").select("*").eq("id", story.family_id).maybeSingle(), // "*": labs — колонка #223
        familyEditedIn(db, story.id),
      ]);
      labs = (fam.data as { labs?: string[] | null } | null)?.labs ?? null;
      edited = ed;
    } catch (e) {
      console.warn("[chapter] плашка дополнения:", (e as Error).message);
    }
  }
  const view = additionView(story, { on: flag("followup_addition", { familyId: story.family_id, labs }), edited });
  if (!view) return null;
  return <AdditionBannerClient storyId={story.id} token={token} place={place} view={view} />;
}
