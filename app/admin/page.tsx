// /admin — пульт питча (I12): сброс демо-семьи одной кнопкой, режим сцены, ссылки демо, голоса демо.
// Вход по ADMIN_PIN — та же cookie, что у /admin/ai и /center.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Section, btnCls, btnGhostCls, inputCls, Notice } from "@/components/admin/ui";
import { DEMO_FAMILY, DEMO_KIOSK_FAMILY, DEMO_KIOSK_STORY, DEMO_STORAGE_PREFIX, DEMO_STORY_SEEDS, DEMO_STORYTELLER } from "@/fixtures/demo/family";
import { requestOrigin } from "@/lib/book/chapter";
import { BUCKETS, getDbOrNull } from "@/lib/db";
import { audioExt } from "@/lib/db/access";
import { env } from "@/lib/env";
import { isStageMode, STAGE_TIMEOUT_MS } from "@/lib/stage";
import { DEMO_VOICE_KEYS, demoLinks, seedDemo } from "@/scripts/seed-demo";
import { pinMatches } from "./ai/_lib/pin";
import { endAdminSession, isAdmin, isAdminConfigured, startAdminSession } from "./ai/_lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Пульт питча · админка · Книга семьи", robots: { index: false, follow: false } };

const PATH = "/admin";
/** Лимит тела server action в Next по умолчанию — 1 МБ (≈ 1 минута m4a с телефона). */
const MAX_VOICE_BYTES = 1024 * 1024 - 16 * 1024;

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function back(kind: "ok" | "err", message: string): never {
  redirect(`${PATH}?${new URLSearchParams({ [kind]: message }).toString()}`);
}

const VOICE_LABEL: Record<string, string> = {
  ...Object.fromEntries(DEMO_STORY_SEEDS.map((s) => [s.key, `Ким · «${s.edit.title}»`])),
  [DEMO_KIOSK_STORY.key]: `Киоск · «${DEMO_KIOSK_STORY.edit.title}»`,
  consent: "Ким · голосовое согласие",
};

// ---------------- server actions ----------------

async function login(fd: FormData) {
  "use server";
  const pin = String(fd.get("pin") ?? "");
  if (!pinMatches(env.adminPin(), pin)) {
    await new Promise((r) => setTimeout(r, 800));
    back("err", "Неверный PIN.");
  }
  await startAdminSession();
  redirect(PATH);
}

async function logout() {
  "use server";
  await endAdminSession();
  redirect(PATH);
}

async function resetDemo() {
  "use server";
  if (!(await isAdmin())) back("err", "Сессия истекла — введите PIN ещё раз.");
  let message: string;
  try {
    // Книгу собирает ручка /api/books (в её функции лежат шрифты PDF)
    const r = await seedDemo({ origin: await requestOrigin(), book: "http" });
    const voices = r.voices.missing.length ? ` Голосов ${r.voices.found} из ${r.voices.total}.` : "";
    const book = r.book.status === "ready" ? `книга ${r.book.pages ?? "?"} стр.` : `книга: ${r.book.status}${r.book.error ? ` (${r.book.error})` : ""}`;
    message = `Демо сброшено за ${(r.ms / 1000).toFixed(1)} с: ${r.chapters} глав, сказка, история киоска, ${book}.${voices}`;
  } catch (e) {
    console.error("[admin] сброс демо:", e);
    back("err", `Сброс не удался: ${e instanceof Error ? e.message : String(e)}`);
  }
  revalidatePath(PATH);
  back("ok", message);
}

async function uploadVoice(fd: FormData) {
  "use server";
  if (!(await isAdmin())) back("err", "Сессия истекла — введите PIN ещё раз.");
  const key = String(fd.get("key") ?? "");
  const file = fd.get("file");
  if (!(DEMO_VOICE_KEYS as readonly string[]).includes(key)) back("err", "Выберите, к какой главе голос.");
  if (fd.get("consent") !== "on") back("err", "Без согласия человека, чей это голос, загружать нельзя.");
  if (!(file instanceof File) || file.size === 0) back("err", "Выберите файл с записью.");
  if (file.size > MAX_VOICE_BYTES) back("err", "Файл больше 1 МБ — запишите покороче (до минуты).");
  const ext = audioExt(file.type || "audio/mp4");
  if (!ext) back("err", "Этот формат не подходит. Подойдут m4a, mp3, webm, ogg, wav.");
  const db = getDbOrNull();
  if (!db) back("err", "База не настроена.");

  try {
    const folder = DEMO_STORAGE_PREFIX;
    const { data: old } = await db.storage.from(BUCKETS.audio).list(folder, { limit: 200 });
    const stale = (old ?? []).filter((f) => f.name.replace(/\.[a-z0-9]+$/i, "") === key).map((f) => `${folder}/${f.name}`);
    if (stale.length) await db.storage.from(BUCKETS.audio).remove(stale);
    const path = `${folder}/${key}.${ext}`;
    const up = await db.storage.from(BUCKETS.audio).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "audio/mp4", upsert: true });
    if (up.error) throw new Error(up.error.message);
    // Сразу привязываем к демо, без сброса
    if (key === "consent") await db.from("storytellers").update({ consent_audio_url: path }).eq("id", DEMO_STORYTELLER.id);
    else {
      const storyId = key === DEMO_KIOSK_STORY.key ? DEMO_KIOSK_STORY.id : DEMO_STORY_SEEDS.find((s) => s.key === key)?.id;
      if (storyId) await db.from("stories").update({ audio_url: path }).eq("id", storyId);
    }
  } catch (e) {
    back("err", `Голос не загрузился: ${e instanceof Error ? e.message : String(e)}`);
  }
  revalidatePath(PATH);
  back("ok", `Голос «${VOICE_LABEL[key] ?? key}» загружен и привязан к демо.`);
}

// ---------------- состояние демо ----------------

interface DemoState {
  exists: boolean;
  chapters: number;
  withVoice: number;
  book: string;
  voices: Set<string>;
  kiosk: boolean;
}

async function loadState(): Promise<DemoState | null> {
  const db = getDbOrNull();
  if (!db) return null;
  const [fam, stories, books, files, kiosk] = await Promise.all([
    db.from("families").select("id").eq("id", DEMO_FAMILY.id).maybeSingle(),
    db.from("stories").select("id, status, audio_url").eq("family_id", DEMO_FAMILY.id).is("parent_story_id", null),
    db.from("books").select("status, page_count").eq("family_id", DEMO_FAMILY.id).order("created_at", { ascending: false }).limit(1),
    db.storage.from(BUCKETS.audio).list(DEMO_STORAGE_PREFIX, { limit: 200 }),
    db.from("stories").select("id").eq("id", DEMO_KIOSK_STORY.id).maybeSingle(),
  ]);
  const rows = (stories.data ?? []) as { status: string; audio_url: string | null }[];
  const b = (books.data?.[0] ?? null) as { status: string; page_count: number | null } | null;
  return {
    exists: Boolean(fam.data),
    chapters: rows.filter((r) => r.status === "ready").length,
    withVoice: rows.filter((r) => r.audio_url).length,
    book: b ? (b.status === "ready" ? `готова, ${b.page_count ?? "?"} стр.` : b.status) : "нет",
    voices: new Set((files.data ?? []).filter((f) => f.id !== null).map((f) => f.name.replace(/\.[a-z0-9]+$/i, ""))),
    kiosk: Boolean(kiosk.data),
  };
}

// ---------------- страница ----------------

export default async function AdminPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const ok = one(sp.ok);
  const err = one(sp.err);

  if (!isAdminConfigured()) {
    return (
      <Shell>
        <Notice tone="info">Админка выключена: задайте ADMIN_PIN в Vercel → Environment Variables и сделайте redeploy.</Notice>
      </Shell>
    );
  }

  if (!(await isAdmin())) {
    return (
      <Shell>
        {err ? <Notice tone="err">{err}</Notice> : null}
        <form action={login} className="flex flex-col gap-3 rounded-card bg-paper-deep p-5 shadow-card">
          <label className="flex flex-col gap-1">
            <span className="text-ink-soft">PIN администратора</span>
            <input className={inputCls} name="pin" type="password" inputMode="numeric" autoComplete="current-password" required autoFocus />
          </label>
          <button className={btnCls} type="submit">
            Войти
          </button>
        </form>
      </Shell>
    );
  }

  const origin = (env.prodUrl() ?? (await requestOrigin())).replace(/\/+$/, "");
  let state: DemoState | null = null;
  let loadError: string | null = null;
  try {
    state = await loadState();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }
  const stage = isStageMode();

  return (
    <Shell
      right={
        <form action={logout}>
          <button className={btnGhostCls} type="submit">
            Выйти
          </button>
        </form>
      }
    >
      {ok ? <Notice tone="ok">{ok}</Notice> : null}
      {err ? <Notice tone="err">{err}</Notice> : null}
      {loadError ? <Notice tone="err">Не удалось прочитать демо: {loadError}</Notice> : null}
      {!state && !loadError ? <Notice tone="info">База не настроена — сброс демо работает только с Supabase.</Notice> : null}

      <Section
        title="Демо-семья"
        hint={
          <>
            Вымышленный рассказчик {DEMO_STORYTELLER.name} — подписан как пример. Сброс пересоздаёт главы, уточнения, сказку, историю киоска и
            книгу; ссылки и QR остаются прежними. Из терминала: <code>npm run seed:demo</code>, из GitHub: Actions → seed-demo.
          </>
        }
      >
        {state ? (
          <ul className="flex flex-col gap-1 text-ink-soft">
            <li>Семья: {state.exists ? "есть" : "нет — нажмите «Сбросить демо»"}</li>
            <li>
              Готовых глав: {state.chapters} из {DEMO_STORY_SEEDS.length}, с голосом: {state.withVoice}
            </li>
            <li>Книга: {state.book}</li>
            <li>История киоска: {state.kiosk ? "есть" : "нет"}</li>
          </ul>
        ) : null}
        <form action={resetDemo}>
          <button className={`${btnCls} w-full`} type="submit">
            Сбросить демо
          </button>
        </form>
      </Section>

      <Section
        title={`Режим сцены: ${stage ? "включён" : "выключен"}`}
        hint={
          stage
            ? `Шаг ИИ для демо-семьи без ответа за ${STAGE_TIMEOUT_MS / 1000} с → заранее готовый результат (в логах Vercel «[stage]»). Настоящих семей не касается.`
            : "Перед питчем: Vercel → Environment Variables → STAGE_MODE=1 → Redeploy. После — убрать."
        }
      >
        <p className="text-sm text-muted">Без интернета на сцене всё демо уже лежит в базе и хранилище: главы, книга, сказка и картинки не ждут ИИ.</p>
      </Section>

      <Section title="Ссылки демо" hint="Открывать с телефона. Токен семьи фиксированный.">
        <ul className="flex flex-col gap-2">
          {demoLinks().map((l) => (
            <li key={l.path}>
              <a href={`${origin}${l.path}`} className="flex min-h-12 items-center rounded-button border border-line bg-paper px-4 break-all">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Семья киоска: {DEMO_KIOSK_FAMILY.name}.</p>
      </Section>

      <Section
        title="Голоса демо"
        hint="Только запись человека, который согласился озвучить вымышленного рассказчика. Файл до 1 МБ (около минуты). Привязывается сразу и переживает сброс."
      >
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {DEMO_VOICE_KEYS.map((k) => (
            <li key={k} className={state?.voices.has(k) ? "text-success" : "text-muted"}>
              {state?.voices.has(k) ? "✓" : "○"} {VOICE_LABEL[k] ?? k}
            </li>
          ))}
        </ul>
        <form action={uploadVoice} className="flex flex-col gap-3">
          <select name="key" className={inputCls} required defaultValue="">
            <option value="" disabled>
              К какой главе голос
            </option>
            {DEMO_VOICE_KEYS.map((k) => (
              <option key={k} value={k}>
                {VOICE_LABEL[k] ?? k}
              </option>
            ))}
          </select>
          <input className={inputCls} name="file" type="file" accept="audio/*" required />
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" name="consent" required className="size-6" />
            <span>Человек, чей это голос, согласен, что запись звучит в демо как пример</span>
          </label>
          <button className={btnCls} type="submit">
            Загрузить голос
          </button>
        </form>
      </Section>

      <Link href="/admin/ai" className="flex min-h-12 items-center justify-center rounded-button border border-line bg-paper px-4">
        ИИ: расход и провайдеры →
      </Link>
    </Shell>
  );
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">Книга семьи · админка</p>
          <h1 className="font-serif text-2xl">Пульт питча</h1>
        </div>
        {right}
      </header>
      {children}
    </main>
  );
}
