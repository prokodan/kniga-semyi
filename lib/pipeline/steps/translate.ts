// Шаг 3: перевод главы на корейский → text_ko, title_ko, quote_ko.
import { namesForTranslate } from "../entities";
import { applySpellings, learnSpellings, requiredSpellings } from "../names";
import type { StepFn } from "./context";
import { StepError } from "./context";

export const translate: StepFn = async ({ story, ai, repo, deadline }) => {
  if (!story.text_ru) throw new StepError("Нет русского текста для перевода");
  // #102: корейское написание имён и мест из словаря семьи (только где оно есть) — одно во всей книге
  const entities = repo.familyEntities ? await repo.familyEntities(story) : [];
  const names = namesForTranslate(entities);
  const raw = await ai.run(
    "translate",
    { text_ru: story.text_ru, title: story.title ?? "", quote: story.quote ?? "", ...(names.length ? { names } : {}) },
    { storyId: story.id, deadline },
  );
  // #124: переводчик всё же написал имя по-своему — его вариант меняем на словарный (правка семьи важнее)
  let { out, fixed } = applySpellings(raw, requiredSpellings(entities));
  // #121: имена этой главы без написания в словаре — запоминаем, как их написал переводчик (первая глава задаёт
  // написание для всей книги). Соседняя глава могла успеть раньше — тогда приводим эту главу к её варианту.
  // Словарь — помощник: его сбой главу не роняет.
  if (repo.saveSpellings && repo.familyEntities) {
    try {
      const learn = learnSpellings(entities, raw.names, story.id);
      if (learn.length) {
        await repo.saveSpellings(story, learn);
        const again = applySpellings(out, requiredSpellings(await repo.familyEntities(story)));
        out = again.out;
        fixed = [...fixed, ...again.fixed];
      }
    } catch (e) {
      console.warn(`[pipeline] написание имён ${story.id.slice(0, 8)}:`, (e as Error).message);
    }
  }
  if (fixed.length) console.info(`[pipeline] имена ${story.id.slice(0, 8)}: ${fixed.map((f) => `${f.from} → ${f.to}`).join(", ")}`);
  return { text_ko: out.text_ko, title_ko: out.title_ko, quote_ko: out.quote_ko };
};
