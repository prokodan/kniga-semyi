import "server-only";
// Сборка книги (I5): готовые главы семьи → PDF A5 → bucket books → books.status building → ready | failed.
// Supabase (service-ключ) — прод; без него — память процесса (локальный запуск, mock), PDF отдаётся из памяти.
import { env } from "@/lib/env";
import type { Book, BookStatus, Family, Story, Storyteller } from "@/lib/types";
import { BUCKETS, getDbOrNull } from "@/lib/db";
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import { photoSignedUrl } from "./chapter";
import { listenUrl } from "./qr";
import { DEMO_BOOK } from "./pdf/demo";
import { isBookChapter, type BookTree, type Elder } from "./pdf/model";
import { flag } from "@/lib/flags";
import { loadTree } from "@/lib/tree";
import { treeForBook } from "@/lib/tree/book";
import { renderBook } from "./pdf/render";
import { effectiveBookLangs } from "@/lib/pipeline/langs";
import { loadStoryTexts, withStoryTexts, type StoryTextRow } from "./texts";

/** Минимум глав, с которого книга «как настоящая» (собрать можно и раньше — экран предупредит). */
export const BOOK_MIN_CHAPTERS = 5;
/** Если сборка «висит» дольше — считаем её упавшей и разрешаем новую. */
const BUILDING_STALE_MS = 2 * 60 * 1000;

export type BookView = Pick<Book, "status" | "page_count" | "built_at" | "error" | "title"> & {
  /** Есть ли PDF для скачивания (последняя удачная сборка) */
  has_pdf: boolean;
  /** Сколько глав готово для книги сейчас */
  chapters_ready: number;
  updated_at: string | null;
  /** PDF есть, но главы поменялись после сборки (словарь имён #104) — книгу нужно пересобрать */
  outdated: boolean;
};

export interface BuildResult {
  status: BookStatus;
  page_count: number | null;
  chapters: number;
  bytes: number;
  ms: number;
  error: string | null;
  /** Корейские слоги вне шрифта — пропадут в PDF (видно только в логе и ответе) */
  missing_korean: string[];
}

export class BookBusyError extends Error {
  constructor() {
    super("Книга уже собирается — подождите минуту");
    this.name = "BookBusyError";
  }
}

// ---------------- данные семьи ----------------

interface BookSource {
  family: Pick<Family, "id" | "name" | "book_langs" | "labs">;
  storyteller: Storyteller | null;
  stories: Story[];
  /** #231: строки story_texts глав — для языков без колонок (kk) */
  texts?: StoryTextRow[];
}

async function loadSource(familyId: string): Promise<BookSource | null> {
  const db = getDbOrNull();
  if (!db) {
    const store = getFamilyStore() as Partial<MemoryFamilyStore>;
    const family = store.families?.get(familyId);
    if (!family) return null;
    const storytellers = [...(store.storytellers?.values() ?? [])]
      .filter((s) => s.family_id === familyId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const stories = [...(store.stories?.values() ?? [])].filter((s) => s.family_id === familyId);
    return structuredClone({ family: { id: family.id, name: family.name, book_langs: family.book_langs, labs: family.labs }, storyteller: storytellers[0] ?? null, stories });
  }
  const [fam, st, stories] = await Promise.all([
    // "*", а не список колонок: book_langs (#230) появится только после migrate — запрос не должен падать до него
    db.from("families").select("*").eq("id", familyId).maybeSingle(),
    db.from("storytellers").select("*").eq("family_id", familyId).order("created_at", { ascending: true }).limit(1),
    db.from("stories").select("*").eq("family_id", familyId).eq("status", "ready").is("parent_story_id", null),
  ]);
  if (fam.error) throw new Error(`семья: ${fam.error.message}`);
  if (!fam.data) return null;
  if (st.error) throw new Error(`рассказчик: ${st.error.message}`);
  if (stories.error) throw new Error(`главы: ${stories.error.message}`);
  // #230: тексты глав — из story_texts, если строка есть, иначе старые колонки
  const list = (stories.data ?? []) as Story[];
  const texts = await loadStoryTexts(db, list.map((s) => s.id));
  const f = fam.data as Family;
  return {
    family: { id: f.id, name: f.name, book_langs: f.book_langs, labs: f.labs },
    storyteller: (st.data?.[0] as Storyteller) ?? null,
    stories: list.map((s) => withStoryTexts(s, texts)),
    texts,
  };
}

// ---------------- строка books ----------------

interface MemoryBook {
  book: Book;
  pdf: Buffer | null;
}
const g = globalThis as { __bookMemory?: Map<string, MemoryBook> };
const memory = () => (g.__bookMemory ??= new Map());

async function latestBook(familyId: string): Promise<Book | null> {
  const db = getDbOrNull();
  if (!db) return memory().get(familyId)?.book ?? null;
  const { data, error } = await db.from("books").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`книга: ${error.message}`);
  return (data?.[0] as Book) ?? null;
}

async function saveBook(familyId: string, current: Book | null, patch: Partial<Book>): Promise<Book> {
  const db = getDbOrNull();
  if (!db) {
    const now = new Date().toISOString();
    const prev = memory().get(familyId);
    const book: Book = {
      id: current?.id ?? crypto.randomUUID(),
      family_id: familyId,
      status: "draft",
      title: null,
      cover: {},
      pdf_url: null,
      page_count: null,
      error: null,
      built_at: null,
      created_at: current?.created_at ?? now,
      ...current,
      ...patch,
      updated_at: now,
    };
    memory().set(familyId, { book, pdf: prev?.pdf ?? null });
    return structuredClone(book);
  }
  const q = current
    ? db.from("books").update(patch).eq("id", current.id).select("*").single()
    : db.from("books").insert({ family_id: familyId, ...patch }).select("*").single();
  const { data, error } = await q;
  if (error || !data) throw new Error(`запись книги: ${error?.message ?? "нет данных"}`);
  return data as Book;
}

// ---------------- фото ----------------

/** Фото рассказчика для обложки: jpg/png до 8 МБ, не дольше 8 с. Нет/не вышло — обложка без фото. */
async function loadPhoto(path: string | null): Promise<Buffer | null> {
  const url = await photoSignedUrl(path, 5 * 60);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null;
    const jpg = buf[0] === 0xff && buf[1] === 0xd8;
    const png = buf[0] === 0x89 && buf[1] === 0x50;
    return jpg || png ? buf : null; // HEIC и прочее react-pdf не умеет — обложка без фото
  } catch (e) {
    console.error("[book] фото для обложки:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------- публичное API ----------------

export async function getBookView(familyId: string): Promise<BookView> {
  const [book, src] = await Promise.all([latestBook(familyId), loadSource(familyId)]);
  // «Повисшая» сборка (функция упала по таймауту) — показываем как неудачную, кнопка снова доступна
  const stale = book?.status === "building" && Date.now() - Date.parse(book.updated_at) > BUILDING_STALE_MS;
  return {
    status: stale ? "failed" : (book?.status ?? "draft"),
    title: book?.title ?? null,
    page_count: book?.page_count ?? null,
    built_at: book?.built_at ?? null,
    error: stale ? "сборка прервалась" : (book?.error ?? null),
    has_pdf: Boolean(book?.pdf_url),
    chapters_ready: src ? src.stories.filter(isBookChapter).length : 0,
    updated_at: book?.updated_at ?? null,
    outdated: !stale && book?.status === "draft" && Boolean(book?.pdf_url),
  };
}

/**
 * Главы поменялись после сборки (правка словаря имён #104): готовая книга → draft. PDF и дата сборки
 * остаются — их можно открыть, а экран книги просит пересобрать. Нет книги или она не готова — ничего.
 */
export async function markBookOutdated(familyId: string): Promise<void> {
  const book = await latestBook(familyId);
  if (book?.status === "ready") await saveBook(familyId, book, { status: "draft" });
}

function bookTitle(familyName: string): string {
  const name = familyName.trim();
  return /книг/i.test(name) ? name : `Книга семьи: ${name}`;
}

/**
 * Собрать книгу. origin — для абсолютных QR-ссылок (если задан PROD_URL — берём его: PDF живёт дольше превью).
 * Ошибка сборки пишется в books.error и возвращается как status: "failed" (не исключение).
 */
export async function buildBook(familyId: string, opts: { origin: string }): Promise<BuildResult> {
  const src = await loadSource(familyId);
  if (!src) throw new Error("Семья не найдена");

  let book = await latestBook(familyId);
  if (book?.status === "building" && Date.now() - Date.parse(book.updated_at) < BUILDING_STALE_MS) throw new BookBusyError();

  const cover = (book?.cover ?? {}) as { title?: unknown; elder?: unknown };
  const title = typeof cover.title === "string" && cover.title.trim() ? cover.title.trim() : bookTitle(src.family.name);
  const elder: Elder | undefined = cover.elder === "grandmother" || cover.elder === "grandfather" ? cover.elder : undefined;
  book = await saveBook(familyId, book, { status: "building", error: null, title });

  const started = Date.now();
  try {
    const origin = env.prodUrl() ?? opts.origin;
    const st = src.storyteller;
    // #231: казахский — только с флагом lang_kk (семье выключили — книга как сейчас, ru + ko)
    const langs = effectiveBookLangs(src.family, flag("lang_kk", { familyId: src.family.id, labs: src.family.labs }));
    // #235: страница древа — только если флаг family_tree включён семье; сбой древа книгу не роняет
    let tree: BookTree | null = null;
    if (flag("family_tree", { familyId, labs: src.family.labs })) {
      try {
        const { model } = await loadTree(familyId, { write: true, viewer: st?.id ?? null });
        tree = treeForBook(model, langs.includes("ko"));
      } catch (e) {
        console.warn(`[book] ${familyId}: древо не собралось — ${e instanceof Error ? e.message : e}`);
      }
    }
    const rendered = await renderBook({
      title,
      storyteller: {
        name: st?.name ?? src.family.name,
        name_ko: st?.name_ko ?? null,
        birth_year: st?.birth_year ?? null,
        death_year: st?.death_year ?? null,
        birth_place: st?.birth_place ?? null,
      },
      photo: await loadPhoto(st?.photo_url ?? null),
      stories: src.stories,
      voiceUrl: (id) => listenUrl(origin, id),
      elder,
      langs,
      texts: src.texts,
      tree,
    });
    if (rendered.missingKorean.length) console.warn(`[book] ${familyId}: нет в шрифте слогов ${rendered.missingKorean.join("")}`);

    const db = getDbOrNull();
    let pdfUrl: string;
    if (db) {
      pdfUrl = `${familyId}/kniga-${Date.now()}.pdf`;
      const up = await db.storage.from(BUCKETS.books).upload(pdfUrl, rendered.pdf, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error(`загрузка PDF: ${up.error.message}`);
      const old = book.pdf_url;
      if (old && old !== pdfUrl) void db.storage.from(BUCKETS.books).remove([old]).then(() => undefined, () => undefined);
    } else {
      pdfUrl = `memory:${familyId}`;
      const m = memory().get(familyId);
      if (m) m.pdf = rendered.pdf;
    }

    await saveBook(familyId, book, {
      status: "ready",
      pdf_url: pdfUrl,
      page_count: rendered.pageCount,
      error: null,
      built_at: new Date().toISOString(),
    });
    const ms = Date.now() - started;
    console.info(`[book] ${familyId}: ${rendered.chapters} глав, ${rendered.pageCount} стр., ${Math.round(rendered.pdf.length / 1024)} КБ, ${ms} мс`);
    return {
      status: "ready",
      page_count: rendered.pageCount,
      chapters: rendered.chapters,
      bytes: rendered.pdf.length,
      ms,
      error: null,
      missing_korean: rendered.missingKorean,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[book] ${familyId}: сборка упала:`, message);
    // pdf_url прошлой удачной сборки оставляем — её по-прежнему можно скачать
    await saveBook(familyId, book, { status: "failed", error: message.slice(0, 500) });
    return { status: "failed", page_count: null, chapters: 0, bytes: 0, ms: Date.now() - started, error: message, missing_korean: [] };
  }
}

/** Последний PDF: подписанная ссылка Storage (час; download — файлом, иначе откроется просмотр) или байты из памяти. */
export async function bookPdf(familyId: string, opts: { download?: boolean } = {}): Promise<{ url: string } | { pdf: Buffer } | null> {
  const book = await latestBook(familyId);
  if (!book?.pdf_url) return null;
  const db = getDbOrNull();
  if (!db) {
    const pdf = memory().get(familyId)?.pdf;
    return pdf ? { pdf } : null;
  }
  const { data, error } = await db.storage.from(BUCKETS.books).createSignedUrl(book.pdf_url, 60 * 60, opts.download ? { download: "kniga-semyi.pdf" } : undefined);
  if (error || !data) {
    console.error("[book] ссылка на PDF:", error?.message);
    return null;
  }
  return { url: data.signedUrl };
}

const demoCache = new Map<string, Promise<Buffer>>();

/** Демо-книга (lib/book/pdf/demo.ts) — QR ведут на /start. Кэш на процесс по origin. */
export function demoBookPdf(origin: string): Promise<Buffer> {
  const base = (env.prodUrl() ?? origin).replace(/\/+$/, "");
  let p = demoCache.get(base);
  if (!p) {
    p = renderBook({ ...DEMO_BOOK, builtAt: new Date(), voiceUrl: () => `${base}/start` }).then((r) => r.pdf);
    p.catch(() => demoCache.delete(base));
    demoCache.set(base, p);
  }
  return p;
}
