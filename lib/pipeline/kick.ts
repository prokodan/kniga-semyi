import "server-only";
// #171: подстраховка конвейера на сервере — то же, что scripts/kick-stuck.mjs, но её вызывает таймер Supabase
// (pg_cron + pg_net раз в 5 мин → /api/cron/kick), а не GitHub cron, который по факту запускался раз в 8–12 ч.
// Истории, стоящие на шаге > 5 мин, перезапускаются через POST /process (с токеном семьи); ≤ 3 попыток, потом
// failed с понятной причиной; поздние попытки failed по перегрузке — раз в час, ещё 6, первые 72 ч (#98).
// Вызовы /process идут параллельно и ждём их не дольше KICK_WAIT_MS — ручка укладывается в 60 с функции.
// В отчёт — только начала id и статусы, без токенов и текстов.
import { getDb } from "@/lib/db";
import type { StoryStatus } from "@/lib/types";
import {
  KICK_ACTIVE,
  KICK_FAILED,
  KICK_LATE_EVERY_MS,
  KICK_LATE_MAX_PER_RUN,
  KICK_LATE_WINDOW_MS,
  KICK_MAX_ATTEMPTS,
  KICK_LATE_ATTEMPTS,
  KICK_MAX_PER_RUN,
  KICK_STALE_MS,
  KICK_WAIT_MS,
  kickAction,
  kickCause,
  kickFailedMessage,
  type KickCandidate,
} from "./kick-rule";

export interface KickReport {
  found: number;
  kicked: number;
  failed: number;
  lines: string[];
}

const short = (id: string) => id.slice(0, 8);
const COLS = "id, family_id, status, kick_attempts";

interface ProcessReply {
  ran?: string | null;
  status?: string;
  next?: string | null;
  queued?: boolean;
  running?: boolean;
  waiting?: boolean;
}

export async function runKick(origin: string, opts: { dryRun?: boolean; now?: number } = {}): Promise<KickReport> {
  const db = getDb();
  const now = opts.now ?? Date.now();
  const deadline = now + KICK_WAIT_MS;
  const { data: stuckRows, error: e1 } = await db
    .from("stories")
    .select(COLS)
    .in("status", KICK_ACTIVE)
    .lt("updated_at", new Date(now - KICK_STALE_MS).toISOString())
    .order("updated_at", { ascending: true })
    .limit(KICK_MAX_PER_RUN);
  if (e1) throw new Error(`stories: ${e1.message}`);
  const { data: lateRows, error: e2 } = await db
    .from("stories")
    .select(COLS)
    .eq("status", "failed")
    .like("error", `${KICK_FAILED}%`)
    .is("parent_story_id", null)
    .lt("updated_at", new Date(now - KICK_LATE_EVERY_MS).toISOString())
    .gt("created_at", new Date(now - KICK_LATE_WINDOW_MS).toISOString())
    .lt("kick_attempts", KICK_MAX_ATTEMPTS + KICK_LATE_ATTEMPTS)
    .order("updated_at", { ascending: true })
    .limit(KICK_LATE_MAX_PER_RUN);
  if (e2) throw new Error(`stories (late): ${e2.message}`);
  const all: KickCandidate[] = [
    ...((stuckRows ?? []) as KickCandidate[]),
    ...((lateRows ?? []) as KickCandidate[]).map((s) => ({ ...s, late: true })),
  ];

  const report: KickReport = { found: all.length, kicked: 0, failed: 0, lines: [] };
  const tokens = new Map<string, string | null>();
  const token = async (familyId: string) => {
    if (!tokens.has(familyId)) {
      const { data } = await db.from("families").select("access_token").eq("id", familyId).maybeSingle();
      tokens.set(familyId, (data as { access_token?: string } | null)?.access_token ?? null);
    }
    return tokens.get(familyId) ?? null;
  };

  await Promise.all(
    all.map(async (s) => {
      const action = kickAction(s);
      const tag = `${short(s.id)} ${s.status}`;
      if (action.kind === "fail") {
        if (!opts.dryRun) {
          const { data: last } = await db
            .from("ai_usage")
            .select("status, error")
            .eq("story_id", s.id)
            .neq("status", "ok")
            .neq("status", "cache_hit")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const error = kickFailedMessage(s.status, action.tries, kickCause((last as { status: string; error: string | null }) ?? null));
          await db
            .from("stories")
            .update({ status: "failed" as StoryStatus, error, step_started_at: null })
            .eq("id", s.id)
            .eq("status", s.status);
        }
        report.failed++;
        report.lines.push(`${tag} → failed (попыток ${action.tries})`);
        return;
      }
      const label = `${s.late ? "поздняя попытка" : "перезапуск"} ${action.tries + 1}/${action.of}`;
      if (opts.dryRun) {
        report.lines.push(`${tag} → ${label} (dry run)`);
        return;
      }
      // Сначала счётчик — с проверкой старого значения: соседний запуск (таймер + ручной kick-stuck) не возьмёт ту же
      const { data: took } = await db
        .from("stories")
        .update({ kick_attempts: action.tries + 1 })
        .eq("id", s.id)
        .eq("kick_attempts", action.tries)
        .select("id");
      if ((took ?? []).length === 0) {
        report.lines.push(`${tag} → уже взял другой запуск`);
        return;
      }
      const t = await token(s.family_id);
      if (!t) {
        report.lines.push(`${tag} → нет семьи, пропуск`);
        return;
      }
      report.kicked++;
      let reply: ProcessReply | null = null;
      try {
        const res = await fetch(`${origin}/api/stories/${encodeURIComponent(s.id)}/process`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-family-token": t },
          body: "{}",
          signal: AbortSignal.timeout(Math.max(2_500, deadline - Date.now())),
        });
        reply = (await res.json().catch(() => ({ status: `HTTP ${res.status}` }))) as ProcessReply;
      } catch {
        // не дождались — шаг идёт в своей функции, следующий шаг сервер запустит сам (chain.ts)
        report.lines.push(`${tag} → ${label}: идёт (ответа не ждали)`);
        return;
      }
      if (reply.waiting) {
        // Не застряла: интервью ещё задаёт уточнения (≤ 20 мин) — попытку не засчитываем
        await db.from("stories").update({ kick_attempts: action.tries }).eq("id", s.id);
      }
      const flags = `${reply.queued ? " (очередь)" : ""}${reply.running ? " (идёт)" : ""}${reply.waiting ? " (ждёт интервью)" : ""}`;
      report.lines.push(`${tag} → ${label}: ${reply.ran ?? "—"}→${reply.status ?? "?"}${flags}`);
    }),
  );
  return report;
}
