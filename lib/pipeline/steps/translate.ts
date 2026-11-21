// Шаг 3: перевод главы на корейский → text_ko, title_ko, quote_ko.
import type { StepFn } from "./context";
import { StepError } from "./context";

export const translate: StepFn = async ({ story, ai }) => {
  if (!story.text_ru) throw new StepError("Нет русского текста для перевода");
  const out = await ai.run(
    "translate",
    { text_ru: story.text_ru, title: story.title ?? "", quote: story.quote ?? "" },
    { storyId: story.id },
  );
  return { text_ko: out.text_ko, title_ko: out.title_ko, quote_ko: out.quote_ko };
};
