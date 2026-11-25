import "server-only";
// Витрина «Архив АКНЦ» (кабинет центра): книги и главы рассказчиков, чьи семьи дали archive_consent.
// #201: только семьи киоска (source = 'kiosk'); семьи /start в кабинет центра не попадают.
// Ссылки: книга /book/<токен>, глава /chapter/<id>?token=…, голос /listen/<id>?s=<подпись> (как QR в книге).
// Кабинет закрыт PIN — ссылки с токеном семьи видит только центр.
import { BLOCKS } from "@/content/questions/blocks";
import { orderByLife } from "@/lib/book/order";
import { listenPath } from "@/lib/book/qr";
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, type MemoryFamilyStore } from "@/lib/db/access";
import type { Book, BookStatus, Family, LifeBlock, Story, Storyteller } from "@/lib/types";

export interface ArchiveChapter {
  id: string;
  block: LifeBlock | null;
  section: string;
  sectionKo: string;
  title: string;
  titleKo: string | null;
  quote: string | null;
  minutes: number;
  chapterHref: string;
  /** null — голоса нет (запись удалена или это демо без загруженного голоса) */
  voiceHref: string | null;
}

export interface ArchiveFamily {
  id: string;
  name: string;
  isDemo: boolean;
  storyteller: { name: string; nameKo: string | null; birthYear: number | null; birthPlace: string | null } | null;
  book: { status: BookStatus | "none"; pages: number | null };
  bookHref: string;
  chapters: ArchiveChapter[];
}

type FamilyPick = Pick<Family, "id" | "name" | "source" | "access_token" | "is_demo" | "created_at">;
type StPick = Pick<Storyteller, "family_id" | "name" | "name_ko" | "birth_year" | "birth_place" | "created_at">;
type StoryPick = Pick<Story, "id" | "family_id" | "block" | "title" | "title_ko" | "quote" | "duration_sec" | "audio_url" | "created_at">;
type BookPick = Pick<Book, "family_id" | "status" | "page_count" | "created_at">;

interface ArchiveRows {
  families: FamilyPick[];
  storytellers: StPick[];
  stories: StoryPick[];
  books: BookPick[];
}

async function rows(): Promise<ArchiveRows> {
  const db = getDbOrNull();
  if (!db) {
    const store = getFamilyStore() as Partial<MemoryFamilyStore>;
    const g = globalThis as { __bookMemory?: Map<string, { book: Book }> };
    const families = [...(store.families?.values() ?? [])].filter((f) => f.archive_consent && f.source === "kiosk");
    const ids = new Set(families.map((f) => f.id));
    return structuredClone({
      families,
      storytellers: [...(store.storytellers?.values() ?? [])].filter((s) => ids.has(s.family_id)),
      stories: [...(store.stories?.values() ?? [])].filter((s) => ids.has(s.family_id) && s.status === "ready" && !s.parent_story_id),
      books: [...(g.__bookMemory?.values() ?? [])].map(({ book }) => book).filter((b) => ids.has(b.family_id)),
    });
  }
  const fam = await db
    .from("families")
    .select("id, name, source, access_token, is_demo, created_at")
    .eq("archive_consent", true)
    .eq("source", "kiosk")
    .limit(500);
  if (fam.error) throw new Error(`архив: ${fam.error.message}`);
  const families = (fam.data ?? []) as FamilyPick[];
  const ids = families.map((f) => f.id);
  if (ids.length === 0) return { families, storytellers: [], stories: [], books: [] };
  const [st, stories, books] = await Promise.all([
    db.from("storytellers").select("family_id, name, name_ko, birth_year, birth_place, created_at").in("family_id", ids),
    db
      .from("stories")
      .select("id, family_id, block, title, title_ko, quote, duration_sec, audio_url, created_at")
      .in("family_id", ids)
      .eq("status", "ready")
      .is("parent_story_id", null)
      .limit(5000),
    db.from("books").select("family_id, status, page_count, created_at").in("family_id", ids),
  ]);
  for (const [what, r] of [
    ["рассказчики", st],
    ["главы", stories],
    ["книги", books],
  ] as const)
    if (r.error) throw new Error(`архив, ${what}: ${r.error.message}`);
  return {
    families,
    storytellers: (st.data ?? []) as StPick[],
    stories: (stories.data ?? []) as StoryPick[],
    books: (books.data ?? []) as BookPick[],
  };
}

/** Чистая сборка витрины из строк (тестируется без базы). */
export function buildArchive(r: ArchiveRows, opts: { hideDemo?: boolean } = {}): ArchiveFamily[] {
  const byCreated = <T extends { created_at: string }>(xs: T[]) => [...xs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return byCreated(r.families)
    .filter((f) => f.source === "kiosk" && !(opts.hideDemo && f.is_demo))
    .map((f) => {
      const token = encodeURIComponent(f.access_token);
      const st = byCreated(r.storytellers.filter((s) => s.family_id === f.id))[0] ?? null;
      const book = byCreated(r.books.filter((b) => b.family_id === f.id)).at(-1) ?? null;
      const chapters = orderByLife(r.stories.filter((s) => s.family_id === f.id)).map((s, i): ArchiveChapter => {
        const b = BLOCKS.find((x) => x.id === s.block);
        return {
          id: s.id,
          block: s.block,
          section: b?.ru ?? "Рассказ",
          sectionKo: b?.ko ?? "이야기",
          title: s.title?.trim() || `Рассказ ${i + 1}`,
          titleKo: s.title_ko?.trim() || null,
          quote: s.quote?.trim() || null,
          minutes: Math.round(((s.duration_sec ?? 0) / 60) * 10) / 10,
          chapterHref: `/chapter/${s.id}?token=${token}`,
          voiceHref: s.audio_url ? listenPath(s.id) : null,
        };
      });
      return {
        id: f.id,
        name: f.name,
        isDemo: f.is_demo,
        storyteller: st ? { name: st.name, nameKo: st.name_ko, birthYear: st.birth_year, birthPlace: st.birth_place } : null,
        book: { status: book?.status ?? "none", pages: book?.page_count ?? null },
        bookHref: `/book/${token}`,
        chapters,
      };
    });
}

export async function loadArchive(opts: { hideDemo?: boolean } = {}): Promise<ArchiveFamily[]> {
  return buildArchive(await rows(), opts);
}
