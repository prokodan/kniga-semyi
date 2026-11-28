// #325: голоса, которые iPhone < 17 не играет (webm / ogg / Opus в mp4 — старый Chrome, Firefox, Samsung Internet),
// → копия AAC `*.aac.m4a` рядом в бакете audio. Плеер (/listen, глава → QR) берёт копию, если она есть
// (lib/book/chapter.ts → playableSignedUrls). Оригиналы и stories.audio_url не трогаем, ничего не удаляем.
// Запуск: Actions → audio-transcode (target prod | staging, apply; по умолчанию dry run) и раз в сутки по расписанию.
// Нужны ffmpeg / ffprobe в PATH. В лог и summary — только короткие id и числа (репозиторий публичный).
import { execFile } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { playablePath } from "@/lib/book/playable";
import {
  applyLimit,
  copyLooksRight,
  decide,
  DECISION_RU,
  ffmpegArgs,
  playsOnOldIphone,
  uniqueRows,
  type AudioRow,
  type Probe,
  type StoredObject,
} from "./audio-plan";

const run = promisify(execFile);
const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TARGET = process.env.AUDIO_TARGET ?? "prod";
const APPLY = process.env.AUDIO_APPLY === "1";
const SCHEDULED = process.env.AUDIO_SCHEDULED === "1";
const MAX = Math.max(1, Number(process.env.AUDIO_MAX ?? 300) || 300);
const BUCKET = "audio";
/** #347: только одна история (запуск сайтом после загрузки записи). Не uuid — ошибка, а не «все». */
const STORY = (process.env.AUDIO_STORY ?? "").trim();
if (STORY && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(STORY)) {
  console.error("AUDIO_STORY — не id истории");
  process.exit(1);
}

const db = createClient(SB || "http://localhost", KEY || "none", { auth: { persistSession: false } });
const short = (id: string) => id.slice(0, 8);
const strip = (p: string) => p.replace(/^\/+/, "").replace(/^audio\//, "");

async function rows(): Promise<AudioRow[]> {
  const fams = await db.from("families").select("id, is_demo").limit(5000);
  if (fams.error) throw new Error(`families: ${fams.error.message}`);
  const demo = new Set((fams.data ?? []).filter((f) => f.is_demo).map((f) => f.id as string));
  const out: AudioRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("stories").select("id, family_id, audio_url, duration_sec, status");
    if (STORY) q = q.eq("id", STORY);
    const r = await q
      .not("audio_url", "is", null)
      .neq("status", "skipped") // «не буду» в плеер не попадает
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (r.error) throw new Error(`stories: ${r.error.message}`);
    for (const s of r.data ?? []) {
      const url = String(s.audio_url);
      if (/^https?:\/\//i.test(url)) continue;
      out.push({ storyId: s.id, familyId: s.family_id, demo: demo.has(s.family_id), path: strip(url), durationSec: s.duration_sec != null ? Number(s.duration_sec) : null });
    }
    if ((r.data ?? []).length < 1000) break;
  }
  return uniqueRows(out);
}

/** Файлы папок, где лежат записи (оригиналы и копии рядом). */
async function objects(paths: string[]): Promise<Map<string, StoredObject>> {
  const folders = [...new Set(paths.map((p) => p.slice(0, Math.max(0, p.lastIndexOf("/")))))];
  const out = new Map<string, StoredObject>();
  for (const folder of folders) {
    for (let offset = 0; ; offset += 1000) {
      const r = await db.storage.from(BUCKET).list(folder, { limit: 1000, offset });
      if (r.error) throw new Error(`storage list ${short(folder)}…: ${r.error.message}`);
      for (const f of r.data ?? []) {
        if (f.id === null) continue; // папка
        const size = Number((f.metadata as { size?: number } | null)?.size ?? 0);
        out.set(folder ? `${folder}/${f.name}` : f.name, { updatedAt: f.updated_at ?? f.created_at ?? new Date(0).toISOString(), size });
      }
      if ((r.data ?? []).length < 1000) break;
    }
  }
  return out;
}

/** ffprobe по файлу или https-ссылке (тогда читает только нужные байты). */
async function probe(file: string): Promise<Probe & { durationSec: number }> {
  let stdout: string;
  try {
    ({ stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name", "-of", "json", file], { timeout: 60_000 }));
  } catch (e) {
    throw new Error(`ffprobe: ${safeErr(e)}`); // в сообщении execFile — команда с подписанной ссылкой: не в лог
  }
  const j = JSON.parse(stdout) as { format?: { format_name?: string; duration?: string }; streams?: { codec_type?: string; codec_name?: string }[] };
  return {
    format: j.format?.format_name ?? "",
    codecs: (j.streams ?? []).filter((s) => s.codec_type === "audio").map((s) => s.codec_name ?? "?"),
    durationSec: Number(j.format?.duration ?? 0) || 0,
  };
}

/** Последняя строка stderr без ссылок и токенов (лог workflow публичный). */
function safeErr(e: unknown): string {
  const err = e as { stderr?: string; killed?: boolean; code?: unknown };
  if (err?.killed) return "таймаут";
  const last = String(err?.stderr ?? "").trim().split("\n").pop() ?? "";
  return (last.replace(/https?:\/\/\S+/g, "<ссылка>").replace(/token=\S+/g, "token=…").slice(0, 120) || `код ${String(err?.code ?? "?")}`);
}

async function download(path: string, dir: string): Promise<string> {
  const r = await db.storage.from(BUCKET).download(path);
  if (r.error || !r.data) throw new Error(`скачать: ${r.error?.message ?? "пусто"}`);
  const file = join(dir, `in.${path.split(".").pop() ?? "bin"}`);
  writeFileSync(file, Buffer.from(await r.data.arrayBuffer()));
  return file;
}

async function main() {
  if (!SB || !KEY) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  const lines: string[] = [];
  const log = (l = "") => {
    lines.push(l);
    console.log(l);
  };
  const all = await rows();
  const store = await objects(all.map((r) => r.path));
  const tmp = mkdtempSync(join(tmpdir(), "audio-"));

  // 1. Решения без скачивания; m4a / mp4 / 3gp — ffprobe по подписанной ссылке (читает только заголовок файла,
  //    не весь голос: почти все записи iPhone — m4a, их проверяем каждый день): Opus в mp4 из Chromium, AMR.
  type Item = AudioRow & { decision: keyof typeof DECISION_RU; why?: string };
  const items: Item[] = all.map((r) => ({ ...r, decision: decide(r.path, store) }));
  for (const it of items.filter((i) => i.decision === "probe")) {
    try {
      const signed = await db.storage.from(BUCKET).createSignedUrl(it.path, 600);
      if (signed.error || !signed.data) throw new Error(`ссылка: ${signed.error?.message ?? "пусто"}`);
      it.decision = playsOnOldIphone(await probe(signed.data.signedUrl)) ? "plays_probe" : "convert";
    } catch (e) {
      it.decision = "failed";
      it.why = e instanceof Error ? e.message.slice(0, 120) : String(e);
    }
  }
  const todo = items.filter((i) => i.decision === "convert" || i.decision === "stale");
  const lim = applyLimit({ apply: APPLY, scheduled: SCHEDULED, todo: todo.length, max: MAX });

  log(`# audio-transcode · ${TARGET} · ${new Date().toISOString()} · ${lim.apply ? "ЗАПИСЬ" : "dry run"}${SCHEDULED ? " · по расписанию" : ""}${STORY ? ` · история ${short(STORY)}` : ""}`);
  log("");
  log(`Записей с голосом: ${items.length} (семей: ${new Set(items.map((i) => i.familyId)).size}). Нужна копия для iPhone: **${todo.length}**` +
    ` (${(todo.reduce((a, i) => a + (store.get(i.path)?.size ?? 0), 0) / 1e6).toFixed(1)} МБ оригиналов), из них демо: ${todo.filter((i) => i.demo).length}.`);
  if (lim.why) log(`\n> ${lim.why}`);

  // 2. Перекодировка (apply): скачать → ffmpeg → проверить ffprobe → загрузить рядом (upsert только копии).
  if (lim.apply) {
    for (const it of todo.slice(0, MAX)) {
      const dir = mkdtempSync(join(tmp, "c"));
      try {
        const input = await download(it.path, dir);
        const output = join(dir, "out.m4a");
        await run("ffmpeg", ffmpegArgs(input, output), { timeout: 300_000 }).catch((e: unknown) => {
          throw new Error(`ffmpeg: ${safeErr(e)}`);
        });
        const check = copyLooksRight(await probe(output), it.durationSec);
        if (!check.ok) throw new Error(`копия не годится: ${check.why}`);
        const up = await db.storage.from(BUCKET).upload(playablePath(it.path)!, readFileSync(output), { contentType: "audio/mp4", upsert: true, cacheControl: "3600" });
        if (up.error) throw new Error(`загрузка: ${up.error.message}`);
        it.decision = "done";
      } catch (e) {
        it.decision = "failed";
        it.why = e instanceof Error ? e.message.slice(0, 160) : String(e);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  rmSync(tmp, { recursive: true, force: true });

  // 3. Итог: по решениям и по семьям (короткие id), ошибки — построчно.
  const by = new Map<string, number>();
  for (const it of items) by.set(it.decision, (by.get(it.decision) ?? 0) + 1);
  log("");
  log("| итог | записей |");
  log("|---|---|");
  for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) log(`| ${DECISION_RU[k as keyof typeof DECISION_RU]} | ${n} |`);
  const fams = new Map<string, { demo: boolean; n: Map<string, number> }>();
  for (const it of items.filter((i) => !["copy_ok", "plays", "plays_probe"].includes(i.decision))) {
    const f = fams.get(it.familyId) ?? { demo: it.demo, n: new Map() };
    f.n.set(it.decision, (f.n.get(it.decision) ?? 0) + 1);
    fams.set(it.familyId, f);
  }
  if (fams.size) {
    log("");
    log("| семья | что |");
    log("|---|---|");
    for (const [id, f] of fams) log(`| ${short(id)}${f.demo ? " (демо)" : ""} | ${[...f.n].map(([k, n]) => `${DECISION_RU[k as keyof typeof DECISION_RU]}: ${n}`).join(" · ")} |`);
  }
  const failed = items.filter((i) => i.decision === "failed");
  if (failed.length) {
    log("");
    log("Ошибки:");
    for (const it of failed) log(`- история ${short(it.storyId)} (.${it.path.split(".").pop()}): ${it.why}`);
  }
  log("");
  log(lim.apply ? "Оригиналы и stories.audio_url не менялись." : "Это план: ничего не записано. Запись — тот же workflow с apply.");

  const md = lines.join("\n") + "\n";
  writeFileSync("audio-transcode.md", md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (failed.length && lim.apply) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
