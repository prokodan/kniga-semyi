// Шаг 3: перевод главы на корейский → text_ko, title_ko, quote_ko.
import { namesForTranslate } from "../entities";
import type { StepFn } from "./context";
import { StepError } from "./context";

export const translate: StepFn = async ({ story, ai, repo, deadline }) => {
  if (!story.text_ru) throw new StepError("Нет русского текста для перевода");
  // #102: корейское написание имён и мест из словаря семьи (только где оно есть) — одно во всей книге
  const names = repo.familyEntities ? namesForTranslate(await repo.familyEntities(story)) : [];
  const out = await ai.run(
    "translate",
    { text_ru: story.text_ru, title: story.title ?? "", quote: story.quote ?? "", ...(names.length ? { names } : {}) },
    { storyId: story.id, deadline },
  );
  return { text_ko: out.text_ko, title_ko: out.title_ko, quote_ko: out.quote_ko };
};
