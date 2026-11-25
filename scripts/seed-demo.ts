// Демо-семья для питча (I12): пересоздаёт демо целиком за секунды.
//   npm run seed:demo                      # ключи прода из .env.local (или env); книгу собирает сайт PROD_URL
//                                          # (без PROD_URL — http://localhost:3000, т.е. запущенный npm run dev)
//   npm run seed:demo -- --illustrate      # + нарисовать «золотые» картинки сказки через ИИ (один раз, OpenAI)
//   npm run seed:demo -- --skip-book       # без сборки PDF
// Тот же сброс — кнопкой в /admin и в Actions → seed-demo (Run workflow).
//
// Что создаётся (ID и токены фиксированные — ссылки и QR после сброса те же, см. fixtures/demo/family.ts):
//   • «Семья Ким · пример»: рассказчик с согласием, сессия интервью, 7 готовых глав RU | KR по банку V0
//     с уточнениями (+ записи-уточнения), книга PDF (I5), сказка с 4 картинками (I8);
//   • «Ли Нина · пример (киоск АКНЦ)»: история с киоска (I4) с archive_consent — видна в кабинете /center (I9).
// Удаляется только то, что принадлежит этим двум семьям. «Золотые» файлы в `_demo/` (голос, картинки) не трогаем:
// они нужны, чтобы демо работало без ИИ и при плохом интернете.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEMO_BOOK_TITLE,
  DEMO_ENTITIES,
  DEMO_FAMILY,
  DEMO_FAMILY_IDS,
  DEMO_KIOSK_FAMILY,
  DEMO_KIOSK_SESSION_ID,
  DEMO_KIOSK_STORY,
  DEMO_KIOSK_STORYTELLER,
  DEMO_SESSION_ID,
  DEMO_STORAGE_PREFIX,
  DEMO_STORY_SEEDS,
  DEMO_STORYTELLER,
  DEMO_TALE,
  DEMO_TALE_EXTRA_ID,
  DEMO_TALE_STORY_KEYS,
  followupStoryId,
  type DemoStorySeed,
} from "@/fixtures/demo/family";
import { DEMO_TALE_ART } from "@/fixtures/demo/tale-art";
import { listenPath } from "@/lib/book/qr";
import { TALE_STYLE } from "@/lib/tale/types";

const B = { audio: "audio", books: "books", illustrations: "illustrations" } as const;

/** Ключи голосов, которые можно загрузить в /admin (audio/_demo/<key>.<ext>). */
export const DEMO_VOICE_KEYS = [...DEMO_STORY_SEEDS.map((s) => s.key), DEMO_KIOSK_STORY.key, "consent"] as const;

export interface SeedOptions {
  /** Для QR в книге, если не задан PROD_URL */
  origin: string;
  /** http — POST <origin>/api/books/:id/build: собирает сам сайт (там шрифты PDF и секрет подписи QR); skip — без книги */
  book?: "http" | "skip";
  /** Нарисовать недостающие «золотые» картинки сказки через ИИ */
  illustrate?: boolean;
  log?: (message: string) => void;
}

export interface SeedReport {
  ms: number;
  chapters: number;
  followups: number;
  entities: number;
  voices: { found: number; total: number; missing: string[] };
  tale: { pages: number; source: "golden" | "ai" | "bundled" | "mixed" };
  book: { status: string; pages: number | null; error: string | null };
  kiosk: { stories: number };
}

// ---------------- хранилище ----------------

async function removeTree(db: SupabaseClient, bucket: string, prefix: string, depth = 0): Promise<number> {
  if (depth > 3) return 0;
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`хранилище ${bucket}/${prefix}: ${error.message}`);
  const files: string[] = [];
  let removed = 0;
  for (const e of data ?? []) {
    const path = `${prefix}/${e.name}`;
    if (e.id === null) removed += await removeTree(db, bucket, path, depth + 1); // папка
    else files.push(path);
  }
  if (files.length) {
    const r = await db.storage.from(bucket).remove(files);
    if (r.error) throw new Error(`удаление ${bucket}/${prefix}: ${r.error.message}`);
  }
  return removed + files.length;
}

/** «Золотые» файлы папки: имя без расширения → путь. */
async function golden(db: SupabaseClient, bucket: string, folder: string): Promise<Map<string, string>> {
  const { data, error } = await db.storage.from(bucket).list(folder, { limit: 200 });
  if (error) throw new Error(`хранилище ${bucket}/${folder}: ${error.message}`);
  const out = new Map<string, string>();
  for (const f of data ?? []) {
    if (f.id === null) continue;
    out.set(f.name.replace(/\.[a-z0-9]+$/i, ""), `${folder}/${f.name}`);
  }
  return out;
}

const extOf = (path: string) => path.split(".").pop()!.toLowerCase();

// ---------------- строки ----------------

function must<T>(what: string, r: { error: { message: string } | null; data?: T }): T | undefined {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const at = (minutes: number) => new Date(Date.parse("2026-11-20T10:00:00+05:00") + minutes * 60_000).toISOString();

function storyRows(seed: DemoStorySeed, opts: { family_id: string; storyteller_id: string; session_id: string; voice: Map<string, string>; i: number }) {
  const t = opts.i * 15;
  const main = {
    id: seed.id,
    family_id: opts.family_id,
    storyteller_id: opts.storyteller_id,
    session_id: opts.session_id,
    parent_story_id: null,
    question_id: seed.question_id,
    block: seed.block,
    audio_url: opts.voice.get(seed.key) ?? null,
    duration_sec: seed.duration_sec,
    transcript: seed.transcript,
    text_ru: seed.edit.text_ru,
    text_ko: seed.translate.text_ko,
    title: seed.edit.title,
    title_ko: seed.translate.title_ko,
    quote: seed.edit.quote,
    quote_ko: seed.translate.quote_ko,
    facts: seed.facts,
    followups: seed.followups.map(({ question, answer }) => ({ question, answer })),
    status: "ready",
    error: null,
    sort_order: null,
    created_at: at(t),
  };
  return { main, minutes: t };
}

// ---------------- главное ----------------

export async function seedDemo(opts: SeedOptions): Promise<SeedReport> {
  const started = Date.now();
  const log = opts.log ?? ((m: string) => console.info(m));
  const { getDb } = await import("@/lib/db");
  const db = getDb();

  // 1. Снести прошлое демо: файлы семей и строки (каскадом — рассказчики, сессии, истории, книги, допы, заказы)
  let removed = 0;
  for (const id of DEMO_FAMILY_IDS) for (const bucket of Object.values(B)) removed += await removeTree(db, bucket, id);
  must("удаление демо-семей", await db.from("families").delete().in("id", [...DEMO_FAMILY_IDS]));
  log(`демо очищено: файлов ${removed}`);

  // 2. Голоса из audio/_demo (загружаются в /admin, только с согласием)
  const voice = await golden(db, B.audio, DEMO_STORAGE_PREFIX);
  const wanted = [...DEMO_STORY_SEEDS.map((s) => s.key), DEMO_KIOSK_STORY.key];
  const missing = wanted.filter((k) => !voice.has(k));

  // 3. Семья Ким
  must(
    "семья",
    await db.from("families").insert({ ...DEMO_FAMILY, created_at: at(-60) }),
  );
  must(
    "рассказчик",
    await db.from("storytellers").insert({ ...DEMO_STORYTELLER, consent_audio_url: voice.get("consent") ?? null, created_at: at(-50) }),
  );
  const answered = DEMO_STORY_SEEDS.map((s) => s.question_id);
  must(
    "сессия",
    await db.from("sessions").insert({
      id: DEMO_SESSION_ID,
      family_id: DEMO_FAMILY.id,
      storyteller_id: DEMO_STORYTELLER.id,
      mode: "family",
      state: {
        covered_blocks: [...new Set(DEMO_STORY_SEEDS.map((s) => s.block))],
        answered_question_ids: answered,
        // следующим агент спросит «Кто помогал вашей семье, когда было трудно?» — для живой записи на сцене
        current_question_id: "hardship-01",
        followups_asked: 0,
        current_story_id: null,
        pending_followup: null,
        recent_answers: DEMO_STORY_SEEDS.slice(-3).map((s) => s.transcript.slice(0, 200)),
      },
      started_at: at(-40),
      ended_at: at(DEMO_STORY_SEEDS.length * 15),
    }),
  );

  const mains = [];
  const children = [];
  for (const [i, seed] of DEMO_STORY_SEEDS.entries()) {
    const { main, minutes } = storyRows(seed, { family_id: DEMO_FAMILY.id, storyteller_id: DEMO_STORYTELLER.id, session_id: DEMO_SESSION_ID, voice, i });
    mains.push(main);
    for (const [j, f] of seed.followups.entries()) {
      children.push({
        id: followupStoryId(i, j),
        family_id: DEMO_FAMILY.id,
        storyteller_id: DEMO_STORYTELLER.id,
        session_id: DEMO_SESSION_ID,
        parent_story_id: seed.id,
        question_id: seed.question_id,
        block: seed.block,
        audio_url: voice.get(`${seed.key}-f${j + 1}`) ?? null,
        duration_sec: f.duration_sec,
        transcript: f.answer,
        status: "ready",
        created_at: at(minutes + 5 + j),
      });
    }
  }
  must("главы", await db.from("stories").insert(mains));
  must("уточнения", await db.from("stories").insert(children));

  // 3б. Словарь имён (#125): как после сборки глав (#102), source=auto. Сброс пересоздаёт — каскад от семьи.
  const storyIdByKey = new Map(DEMO_STORY_SEEDS.map((s) => [s.key, s.id]));
  must(
    "словарь имён",
    await db.from("family_entities").insert(
      DEMO_ENTITIES.map((e) => ({
        family_id: DEMO_FAMILY.id,
        kind: e.kind,
        name_ru: e.name_ru,
        name_ko: e.name_ko,
        description: e.description,
        story_ids: e.stories.map((k) => storyIdByKey.get(k)!),
        source: "auto",
      })),
    ),
  );

  // 4. Киоск АКНЦ → кабинет центра
  must("семья киоска", await db.from("families").insert({ ...DEMO_KIOSK_FAMILY, created_at: at(200) }));
  must(
    "рассказчик киоска",
    await db.from("storytellers").insert({ ...DEMO_KIOSK_STORYTELLER, consent_audio_url: null, created_at: at(201) }),
  );
  must(
    "сессия киоска",
    await db.from("sessions").insert({
      id: DEMO_KIOSK_SESSION_ID,
      family_id: DEMO_KIOSK_FAMILY.id,
      storyteller_id: DEMO_KIOSK_STORYTELLER.id,
      mode: "kiosk",
      volunteer_id: null,
      state: { covered_blocks: [DEMO_KIOSK_STORY.block], answered_question_ids: [DEMO_KIOSK_STORY.question_id], finished: true },
      started_at: at(202),
      ended_at: at(215),
    }),
  );
  const kiosk = storyRows(DEMO_KIOSK_STORY, {
    family_id: DEMO_KIOSK_FAMILY.id,
    storyteller_id: DEMO_KIOSK_STORYTELLER.id,
    session_id: DEMO_KIOSK_SESSION_ID,
    voice,
    i: 14,
  });
  must("история киоска", await db.from("stories").insert(kiosk.main));

  // 5. Сказка: текст готов, картинки — «золотые» → ИИ (по флагу) → акварельные SVG из репозитория
  const taleIds = DEMO_TALE_STORY_KEYS.map((k) => DEMO_STORY_SEEDS.find((s) => s.key === k)!.id);
  must(
    "сказка",
    await db.from("extras").insert({
      id: DEMO_TALE_EXTRA_ID,
      family_id: DEMO_FAMILY.id,
      type: "tale",
      status: "ready",
      data: { title: DEMO_TALE.title, childName: null, storytellerName: DEMO_STORYTELLER.name, style: TALE_STYLE, storyIds: taleIds, pages: DEMO_TALE.pages, error: null },
    }),
  );
  const taleFolder = `${DEMO_STORAGE_PREFIX}/tale`;
  const art = await golden(db, B.illustrations, taleFolder);
  const sources = new Set<string>();
  const ts = Date.now();
  for (const [i, page] of DEMO_TALE.pages.entries()) {
    const target = `${DEMO_FAMILY.id}/${DEMO_TALE_EXTRA_ID}/p${i}-${ts}`;
    let gold = art.get(`p${i}`);
    if (!gold && opts.illustrate) {
      try {
        const { ai } = await import("@/lib/ai");
        const img = await ai.run("illustrate", { prompt: page.illustrationPrompt, style: TALE_STYLE });
        const ext = img.mimeType.includes("png") ? "png" : img.mimeType.includes("jpeg") ? "jpg" : img.mimeType.includes("webp") ? "webp" : "svg";
        gold = `${taleFolder}/p${i}.${ext}`;
        must("золотая картинка", await db.storage.from(B.illustrations).upload(gold, Buffer.from(img.imageBase64, "base64"), { contentType: img.mimeType, upsert: true }));
        sources.add("ai");
      } catch (e) {
        log(`картинка ${i + 1}: ИИ не нарисовал (${e instanceof Error ? e.message : e}) — беру акварель из репозитория`);
        gold = undefined;
      }
    } else if (gold) sources.add("golden");
    if (gold) {
      must("копия картинки", await db.storage.from(B.illustrations).copy(gold, `${target}.${extOf(gold)}`));
    } else {
      must(
        "картинка сказки",
        await db.storage.from(B.illustrations).upload(`${target}.svg`, Buffer.from(DEMO_TALE_ART[i]!), { contentType: "image/svg+xml", upsert: true }),
      );
      sources.add("bundled");
    }
  }

  // 6. Книга PDF
  must("книга", await db.from("books").insert({ family_id: DEMO_FAMILY.id, status: "draft", title: DEMO_BOOK_TITLE, cover: { title: DEMO_BOOK_TITLE, elder: "grandfather" } }));
  let book: SeedReport["book"] = { status: "skipped", pages: null, error: null };
  if ((opts.book ?? "http") === "http") {
    try {
      const res = await fetch(`${opts.origin.replace(/\/+$/, "")}/api/books/${DEMO_FAMILY.id}/build`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-token": DEMO_FAMILY.access_token },
        body: "{}",
        signal: AbortSignal.timeout(55_000),
      });
      const j = (await res.json().catch(() => ({}))) as { status?: string; page_count?: number | null; error?: string | null; message?: string };
      book = { status: j.status ?? `HTTP ${res.status}`, pages: j.page_count ?? null, error: j.error ?? j.message ?? null };
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      book = { status: "failed", pages: null, error: `${why} — сайт ${opts.origin} недоступен? Книгу можно собрать кнопкой на /book/<токен>` };
    }
  }

  const report: SeedReport = {
    ms: Date.now() - started,
    chapters: mains.length,
    followups: children.length,
    entities: DEMO_ENTITIES.length,
    voices: { found: wanted.length - missing.length, total: wanted.length, missing },
    tale: { pages: DEMO_TALE.pages.length, source: sources.size === 1 ? ([...sources][0] as SeedReport["tale"]["source"]) : "mixed" },
    book,
    kiosk: { stories: 1 },
  };
  log(
    `демо готово за ${(report.ms / 1000).toFixed(1)} с: глав ${report.chapters}, уточнений ${report.followups}, словарь ${report.entities}, голосов ${report.voices.found}/${report.voices.total}, ` +
      `сказка ${report.tale.pages} стр. (${report.tale.source}), книга ${book.status}${book.pages ? `, ${book.pages} стр.` : ""}${book.error ? ` — ${book.error}` : ""}`,
  );
  return report;
}

// ---------------- ссылки для проверки ----------------

export interface DemoLink {
  label: string;
  path: string;
}

/** Ссылки демо (пути от origin). Подпись /listen зависит от LISTEN_SECRET / service-ключа — считать на сервере. */
export function demoLinks(): DemoLink[] {
  const t = DEMO_FAMILY.access_token;
  const first = DEMO_STORY_SEEDS[0]!;
  return [
    { label: "Семья Ким — кабинет семьи", path: `/f/${t}` },
    { label: "Запись следующего ответа (интервью)", path: `/record/${t}` },
    { label: `Глава «${first.edit.title}» RU | KR + QR`, path: `/chapter/${first.id}?token=${t}` },
    { label: "Голос по QR (без токена)", path: listenPath(first.id) },
    { label: "Словарь имён семьи", path: `/f/${t}/names` },
    { label: "Книга — экран", path: `/book/${t}` },
    { label: "Книга — PDF", path: `/api/books/${DEMO_FAMILY.id}/pdf?token=${t}` },
    { label: "Сказка для внуков", path: `/extras/${t}/tale` },
    { label: "Допы", path: `/extras/${t}` },
    { label: "Оплата (демо)", path: `/checkout/${t}` },
    { label: "История с киоска АКНЦ — глава", path: `/chapter/${DEMO_KIOSK_STORY.id}?token=${DEMO_KIOSK_FAMILY.access_token}` },
    { label: "Киоск АКНЦ (KIOSK_PIN)", path: "/kiosk" },
    { label: "Кабинет центра — семьи (ADMIN_PIN)", path: "/center/families" },
  ];
}

// ---------------- CLI ----------------

async function main() {
  const path = await import("node:path");
  const fs = await import("node:fs");
  for (const f of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), f);
    if (fs.existsSync(p)) process.loadEnvFile(p);
  }
  // lib/db и lib/book помечены server-only (условие react-server есть только в сборке Next) — в CLI глушим метку.
  const { createRequire } = await import("node:module");
  const req = createRequire(path.join(process.cwd(), "package.json"));
  const marker = req.resolve("server-only");
  req.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as NodeJS.Module;

  const args = new Set(process.argv.slice(2));
  // Книгу собирает сам сайт (PROD_URL; без него — локальный npm run dev): там шрифты PDF и секрет подписи QR.
  const origin = process.env.PROD_URL?.trim() || "http://localhost:3000";
  const report = await seedDemo({ origin, book: args.has("--skip-book") ? "skip" : "http", illustrate: args.has("--illustrate") });

  const lines = [
    `### Демо-семья пересоздана за ${(report.ms / 1000).toFixed(1)} с`,
    `- глав RU | KR: ${report.chapters}, записей-уточнений: ${report.followups}, словарь имён: ${report.entities}, история киоска: ${report.kiosk.stories}`,
    `- голос: ${report.voices.found} из ${report.voices.total}${report.voices.missing.length ? ` (нет: ${report.voices.missing.join(", ")} — загрузить в /admin)` : ""}`,
    `- сказка: ${report.tale.pages} стр., картинки — ${report.tale.source}`,
    `- книга: ${report.book.status}${report.book.pages ? `, ${report.book.pages} стр.` : ""}${report.book.error ? ` — ${report.book.error}` : ""}`,
    "",
    ...demoLinks().map((l) => `- ${l.label}: ${origin.replace(/\/+$/, "")}${l.path}`),
  ];
  console.info(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  if (report.book.status !== "ready" && report.book.status !== "skipped") process.exitCode = 1;
}

if (process.argv[1] && /seed-demo\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("seed:demo упал:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
