import "server-only";
// #200: «Архив» киоска и полноэкранный «▶ Показ» — публичный экран в центре. Только семьи киоска (source = 'kiosk')
// с archive_consent = true (демо «Ли Нина · пример» — тоже). Только чтение и только то, что можно показать залу:
// имя рассказчика, годы, место, главы RU / KR. Никаких access_token, ссылок /f/, /book/, /chapter/?token, /draft
// и голоса: согласие на запись говорит «записи и книгу видит только наша семья» (consent/[token]/text.ts).
// Свой загрузчик, а не app/api/center/_lib/archive.ts: там ссылки с токеном для кабинета центра.
import { BLOCKS } from "@/content/questions/blocks";
import { orderByLife } from "@/lib/book/order";
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, type MemoryFamilyStore } from "@/lib/db/access";
import type { Family, Story, Storyteller } from "@/lib/types";

export interface ShowChapter {
  id: string;
  section: string;
  sectionKo: string;
  title: string;
  titleKo: string | null;
  quote: string | null;
  quoteKo: string | null;
  textRu: string;
  textKo: string | null;
}

export interface ShowFamily {
  id: string;
  isDemo: boolean;
  name: string;
  nameKo: string | null;
  birthYear: number | null;
  birthPlace: string | null;
  chapters: ShowChapter[];
}

type FamilyPick = Pick<Family, "id" | "name" | "is_demo" | "created_at">;
type StPick = Pick<Storyteller, "family_id" | "name" | "name_ko" | "birth_year" | "birth_place" | "created_at">;
type StoryPick = Pick<Story, "id" | "family_id" | "storyteller_id" | "block" | "title" | "title_ko" | "quote" | "quote_ko" | "text_ru" | "text_ko" | "created_at">;

export interface ShowRows {
  families: FamilyPick[];
  storytellers: StPick[];
  stories: StoryPick[];
}

const FAMILY_COLS = "id, name, is_demo, created_at";
const ST_COLS = "family_id, name, name_ko, birth_year, birth_place, created_at";
const STORY_COLS = "id, family_id, storyteller_id, block, title, title_ko, quote, quote_ko, text_ru, text_ko, created_at";

const pick = <T extends object, K extends keyof T>(o: T, keys: K[]) => Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

/** Отбор из полных строк (локальный режим и тесты): только киоск + согласие, только готовые главы, без лишних полей. */
export function pickShowRows(all: { families: Family[]; storytellers: Storyteller[]; stories: Story[] }): ShowRows {
  const families = all.families.filter((f) => f.source === "kiosk" && f.archive_consent);
  const ids = new Set(families.map((f) => f.id));
  return {
    families: families.map((f) => pick(f, ["id", "name", "is_demo", "created_at"])),
    storytellers: all.storytellers
      .filter((s) => ids.has(s.family_id))
      .map((s) => pick(s, ["family_id", "name", "name_ko", "birth_year", "birth_place", "created_at"])),
    stories: all.stories
      .filter((s) => ids.has(s.family_id) && s.status === "ready" && !s.parent_story_id)
      .map((s) => pick(s, ["id", "family_id", "storyteller_id", "block", "title", "title_ko", "quote", "quote_ko", "text_ru", "text_ko", "created_at"])),
  };
}

async function rows(): Promise<ShowRows> {
  const db = getDbOrNull();
  if (!db) {
    const store = getFamilyStore() as Partial<MemoryFamilyStore>;
    return pickShowRows({
      families: [...(store.families?.values() ?? [])],
      storytellers: [...(store.storytellers?.values() ?? [])],
      stories: [...(store.stories?.values() ?? [])],
    });
  }
  const fam = await db.from("families").select(FAMILY_COLS).eq("source", "kiosk").eq("archive_consent", true).limit(500);
  if (fam.error) throw new Error(`архив киоска: ${fam.error.message}`);
  const families = (fam.data ?? []) as FamilyPick[];
  const ids = families.map((f) => f.id);
  if (ids.length === 0) return { families, storytellers: [], stories: [] };
  const [st, stories] = await Promise.all([
    db.from("storytellers").select(ST_COLS).in("family_id", ids),
    db.from("stories").select(STORY_COLS).in("family_id", ids).eq("status", "ready").is("parent_story_id", null).limit(5000),
  ]);
  if (st.error) throw new Error(`архив киоска, рассказчики: ${st.error.message}`);
  if (stories.error) throw new Error(`архив киоска, главы: ${stories.error.message}`);
  return { families, storytellers: (st.data ?? []) as StPick[], stories: (stories.data ?? []) as StoryPick[] };
}

const byCreated = <T extends { created_at: string }>(xs: T[]) => [...xs].sort((a, b) => a.created_at.localeCompare(b.created_at));

/** Чистая сборка витрины (тестируется без базы). Семьи без готовых глав не показываем. */
export function buildShow(r: ShowRows): ShowFamily[] {
  return byCreated(r.families)
    .map((f): ShowFamily => {
      const st = byCreated(r.storytellers.filter((s) => s.family_id === f.id))[0] ?? null;
      const chapters = orderByLife(r.stories.filter((s) => s.family_id === f.id && (s.text_ru ?? "").trim())).map((s, i): ShowChapter => {
        const b = BLOCKS.find((x) => x.id === s.block);
        return {
          id: s.id,
          section: b?.ru ?? "Рассказ",
          sectionKo: b?.ko ?? "이야기",
          title: s.title?.trim() || `Рассказ ${i + 1}`,
          titleKo: s.title_ko?.trim() || null,
          quote: s.quote?.trim() || null,
          quoteKo: s.quote_ko?.trim() || null,
          textRu: (s.text_ru ?? "").trim(),
          textKo: s.text_ko?.trim() || null,
        };
      });
      return {
        id: f.id,
        isDemo: f.is_demo,
        name: st?.name ?? f.name,
        nameKo: st?.name_ko ?? null,
        birthYear: st?.birth_year ?? null,
        birthPlace: st?.birth_place ?? null,
        chapters,
      };
    })
    .filter((f) => f.chapters.length > 0);
}

export async function loadShow(): Promise<ShowFamily[]> {
  return buildShow(await rows());
}
