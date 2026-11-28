// Шаг 3: перевод главы на корейский → text_ko, title_ko, quote_ko (в базе — ещё и story_texts lang=ko, зеркалом).
// #230: шаг вызывается с парой языков (translateInput). #231: языки — по families.book_langs (флаг lang_kk): ru → ko и / или ru → kk.
import { translateInput } from "@/lib/ai/types";
import { fixCyrillic } from "../cyrillic";
import { namesForTranslate } from "../entities";
import { finishKk, learnSpellingsKk, namesForTranslateKk, requiredSpellingsKk } from "../kk";
import { kkLogLines, translateKk } from "../kk-translate";
import { applySpellings, learnSpellings, requiredSpellings } from "../names";
import type { BookLang } from "@/lib/types";
import type { PipelinePatch } from "../repo";
import type { StepContext, StepFn } from "./context";
import { StepError } from "./context";

/**
 * #231: переводы по языкам книги. pending_langs (план движка) — каких переводов ещё нет; не задан — ko, как до #231.
 * ko — в колонки text_ko / title_ko / quote_ko (патч), остальные (kk) — строкой story_texts через repo.saveText.
 */
export const translate: StepFn = async (ctx) => {
  const { story } = ctx;
  if (!story.text_ru) throw new StepError("Нет русского текста для перевода");
  let patch: PipelinePatch = {};
  for (const lang of story.pending_langs ?? ["ko"]) {
    if (lang === "ko") patch = { ...patch, ...(await toKorean(ctx)) };
    else if (lang !== "ru") await toOther(ctx, lang);
  }
  return patch;
};

/** #231: перевод главы ru → lang (сейчас kk) — промпт prompts/translate.<lang>.md, текст — в story_texts. */
async function toOther(ctx: StepContext, lang: Exclude<BookLang, "ru" | "ko">): Promise<void> {
  const { story, ai, repo, deadline } = ctx;
  if (!repo.saveText) throw new StepError(`Перевод на «${lang}» здесь не сохранить`);
  if (lang === "kk") return toKazakh(ctx);
  const out = await ai.run(
    "translate",
    translateInput("ru", lang, { text_ru: story.text_ru!, title: story.title ?? "", quote: story.quote ?? "" }),
    { storyId: story.id, familyId: story.family_id, deadline },
  );
  await repo.saveText(story, lang, { title: out.title_ko, text: out.text_ko, quote: out.quote_ko });
}

/**
 * #298: ru → kk с теми же защитами, что у ko (сюда доходит только семья с флагом lang_kk): словарь семьи во входе
 * (names, казахское написание — family_entities.name_kk), после перевода — алфавит, обращение к внукам и одно
 * написание имён (lib/pipeline/kk.ts), новые имена главы запоминаются (первая глава задаёт написание для книги).
 * #313 #315: русские служебные слова — по-казахски без ИИ; что не исправить — один повтор с retry_note (kk-translate.ts).
 */
async function toKazakh({ story, ai, repo, deadline }: StepContext): Promise<void> {
  const entities = repo.familyEntities ? await repo.familyEntities(story).catch(() => []) : [];
  // #313: один повтор с замечанием, если после исправлений без ИИ остались хангыль / латиница / русские слова (#315)
  const t = await translateKk(
    (input) => ai.run("translate", input, { storyId: story.id, familyId: story.family_id, deadline }),
    { text_ru: story.text_ru!, title: story.title ?? "", quote: story.quote ?? "" },
    namesForTranslateKk(entities),
    requiredSpellingsKk(entities),
  );
  let res = t.res;
  // Словарь — помощник: его сбой главу не роняет. Соседняя глава могла успеть раньше — приводим к её варианту.
  if (repo.saveSpellingsKk && repo.familyEntities) {
    try {
      const learn = learnSpellingsKk(entities, res.out.text_ko, story.id);
      if (learn.length) {
        await repo.saveSpellingsKk(story, learn);
        const again = finishKk(res.out, story.text_ru!, requiredSpellingsKk(await repo.familyEntities(story)));
        res = { ...again, fixed: [...res.fixed, ...again.fixed] };
      }
    } catch (e) {
      console.warn(`[pipeline] написание имён kk ${story.id.slice(0, 8)}:`, (e as Error).message);
    }
  }
  const lines = kkLogLines(story.id.slice(0, 8), { res, retry: t.retry });
  for (const l of lines.info) console.info(l);
  for (const l of lines.warn) console.warn(l);
  await repo.saveText!(story, "kk", { title: res.out.title_ko, text: res.out.text_ko, quote: res.out.quote_ko });
}

async function toKorean({ story, ai, repo, deadline }: StepContext): Promise<PipelinePatch> {
  if (!story.text_ru) throw new StepError("Нет русского текста для перевода");
  // #102: корейское написание имён и мест из словаря семьи (только где оно есть) — одно во всей книге
  const entities = repo.familyEntities ? await repo.familyEntities(story) : [];
  const names = namesForTranslate(entities);
  const raw = await ai.run(
    "translate",
    translateInput("ru", "ko", { text_ru: story.text_ru, title: story.title ?? "", quote: story.quote ?? "", ...(names.length ? { names } : {}) }),
    { storyId: story.id, familyId: story.family_id, deadline },
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
  // #163: кириллицы в корейском быть не должно — словарное написание или транслитерация хангылем
  const cyr = fixCyrillic(out, requiredSpellings(repo.familyEntities ? await repo.familyEntities(story).catch(() => entities) : entities));
  out = cyr.out;
  if (cyr.fixed.length) console.info(`[pipeline] кириллица в KR ${story.id.slice(0, 8)}: ${cyr.fixed.map((f) => `${f.from} → ${f.to}`).join(", ")}`);
  return { text_ko: out.text_ko, title_ko: out.title_ko, quote_ko: out.quote_ko };
}
