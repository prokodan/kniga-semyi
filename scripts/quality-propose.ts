// #354 (docs/v2/QUALITY_LOOP.md §5.2–5.3, §6): workflow quality-propose — только staging.
//   QUALITY_ACTION=propose  — новые находки пары (и компонента, если задан) → патч ТОЛЬКО в разрешённых файлах
//     (lib/quality/propose.ts) → ветка quality/<пара>-<YYYYMMDD>[-N] → PR «какие отзывы → что меняем» + строка
//     «Флаг: не нужен — …»; маршруты моделей и то, что словами не правится, — issues. Запись quality_proposals
//     (draft → eval), находки → proposed. Перед коммитом — `git status`: файл вне списка = отказ, ничего не пушим.
//   QUALITY_ACTION=digest   — разбор новых отзывов (как pg_cron раз в час), без лимита функции 60 с.
//   QUALITY_ACTION=selftest — вымышленная ссылка /review 2.0 с 3 правками носителя (lib/quality/selftest.ts) → разбор →
//     находки этой ссылки → propose (PR с пометкой «самопроверка»). Для проверки контура целиком.
// Сам ничего не сливает. Токен PR: QUALITY_BOT_TOKEN (тогда на PR запускаются ci / e2e / flag-line / eval), иначе
// GITHUB_TOKEN — PR откроется, но проверки GitHub сами не запустит (закрыть и открыть PR руками; секрет — см. заметки #354).
// В лог и Summary — id, пары, компоненты и числа; тексты отзывов — в базе staging и в описании PR (вымышленные).
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hashReviewToken, newReviewToken } from "@/app/admin/reviews/_lib/core";
import { createRouter } from "@/lib/ai/router";
import { SupabaseStore } from "@/lib/ai/store";
import { getAiMode } from "@/lib/env";
import { digestDailyUsd, runDigest } from "@/lib/quality/digest";
import { SupabaseDigestRepo } from "@/lib/quality/digest-repo";
import { COMPONENT_RU, isFindingComponent, type QualityFinding } from "@/lib/quality/findings";
import { PatchRefusedError, assertAllowedPatch, branchName, changedPaths, planProposal, proposalBody } from "@/lib/quality/propose";
import { SELFTEST_SAMPLES } from "@/lib/quality/selftest";
import { PAIR_RU, isQualityPair, type QualityPair } from "@/lib/quality/types";

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TARGET = process.env.QUALITY_TARGET ?? "";
const ACTION = ["digest", "selftest"].includes(process.env.QUALITY_ACTION ?? "") ? process.env.QUALITY_ACTION! : "propose";
const PAIR = process.env.QUALITY_PAIR ?? "ru-kk";
const COMPONENT = process.env.QUALITY_COMPONENT ?? "";
const TRIGGER = process.env.QUALITY_TRIGGER || (ACTION === "selftest" ? "selftest" : "manual");
const IDS = (process.env.QUALITY_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{8,36}$/i.test(s));
const REPO = process.env.GITHUB_REPOSITORY ?? "prokodan/kniga-semyi";
const GH_TOKEN = process.env.GH_TOKEN ?? "";
const BOT_TOKEN = process.env.HAS_BOT_TOKEN === "1";
const RUN_URL = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined;
const DRY = process.env.QUALITY_DRY === "1";

const out: string[] = [];
const log = (l = "") => {
  console.log(l);
  out.push(l);
};
function summary() {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, out.join("\n") + "\n");
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

async function gh<T>(method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${REPO}${p}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "kniga-semyi-quality-propose",
      authorization: `Bearer ${GH_TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { message?: string }).message ?? msg;
    } catch {}
    throw new Error(`GitHub ${res.status}: ${msg}`.slice(0, 200));
  }
  return (await res.json()) as T;
}

/** Свободное имя ветки: quality/<пара>-<дата>, занято — -2, -3… */
function freeBranch(base: string): string {
  const taken = new Set(
    git("ls-remote", "--heads", "origin", `${base}*`)
      .split("\n")
      .map((l) => l.split("refs/heads/")[1])
      .filter(Boolean),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

function readRepoFile(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Вымышленная ссылка 2.0 с тремя правками носителя — сразу «готово». */
async function selftestLink(db: SupabaseClient, pair: "ru-kk" | "ru-ko"): Promise<string> {
  const s = SELFTEST_SAMPLES[pair];
  const [from, to] = pair.split("-") as [string, string];
  const { data: link, error } = await db
    .from("review_links")
    .insert({
      token_hash: hashReviewToken(newReviewToken()),
      pair,
      mode: "texts",
      kind: "text",
      criteria: ["meaning", "natural", "respect", "names", "grammar"],
      ui_lang: s.ui_lang,
      reviewer_label: "Т. С.",
      items_set: "selftest:q3",
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`review_links: ${error.message}`);
  const linkId = (link as { id: string }).id;
  const { data: item, error: e2 } = await db
    .from("review_items")
    .insert({
      link_id: linkId,
      position: 0,
      kind: "chapter",
      source_lang: from,
      target_lang: to,
      title: s.title,
      source_text: s.source.join("\n\n"),
      model_text: s.model.join("\n\n"),
      prompt_version: "selftest",
      persona: "selftest:q3",
    })
    .select("id")
    .single();
  if (e2) throw new Error(`review_items: ${e2.message}`);
  const itemId = (item as { id: string }).id;
  const now = new Date().toISOString();
  const rows = [
    ...s.fix.map((t, i) => ({ item_id: itemId, paragraph: i, edited_text: t, ratings: {}, comment: null, skipped: false, terms: {}, updated_at: now })),
    { item_id: itemId, paragraph: -1, edited_text: null, ratings: { meaning: 3, natural: 3, respect: 2, names: 4, grammar: 3 }, comment: "Самопроверка Q3: родство и обращение к внукам.", skipped: false, terms: {}, updated_at: now },
  ];
  const { error: e3 } = await db.from("review_feedback").insert(rows);
  if (e3) throw new Error(`review_feedback: ${e3.message}`);
  return linkId;
}

async function propose(repo: SupabaseDigestRepo, pair: QualityPair, opts: { ids?: string[]; component?: string; selftest?: boolean }) {
  let findings = await repo.findings({ pair, statuses: ["new"], ...(opts.ids?.length ? { ids: opts.ids } : {}) });
  if (opts.component && isFindingComponent(opts.component)) findings = findings.filter((f) => f.component === opts.component);
  log(`Новых находок ${PAIR_RU[pair]}${opts.component ? ` · ${opts.component}` : ""}: **${findings.length}**`);
  if (!findings.length) {
    log("Предлагать нечего.");
    return;
  }
  const components = [...new Set(findings.map((f) => f.component))];
  const proposal = await repo.addProposal({
    pair,
    findings: findings.map((f) => f.id),
    components,
    summary: findings.map((f) => f.summary).join(" · ").slice(0, 1000),
    trigger: TRIGGER,
    run_id: process.env.GITHUB_RUN_ID ?? null,
  });
  log(`Предложение \`${proposal.id}\` (draft)`);
  const fail = async (msg: string) => {
    await repo.updateProposal(proposal.id, { error: msg.slice(0, 500), status: "rejected" }).catch(() => undefined);
    log(`🔴 ${msg}`);
    process.exitCode = 1;
  };

  let plan: ReturnType<typeof planProposal>;
  try {
    plan = planProposal({ pair, findings, read: readRepoFile });
  } catch (e) {
    if (e instanceof PatchRefusedError) return fail(e.message);
    throw e;
  }
  const files = Object.keys(plan.files);
  log(`Патч: ${files.length ? files.map((f) => `\`${f}\``).join(", ") : "нет"} · issues: ${plan.issues.length} · золотой набор +${plan.goldenAdded}`);
  if (DRY) {
    log("Пробный запуск (QUALITY_DRY=1) — без ветки, PR и issues.");
    await repo.updateProposal(proposal.id, { error: "пробный запуск", status: "rejected" });
    return;
  }

  const issues: { number: number; title: string }[] = [];
  for (const i of plan.issues) {
    const r = await gh<{ number: number }>("POST", "/issues", { title: i.title, body: `${i.body}\n\nИз предложения \`quality_proposals.${proposal.id}\`${RUN_URL ? ` · ${RUN_URL}` : ""}` });
    issues.push({ number: r.number, title: i.title });
    log(`Issue #${r.number}: ${i.title}`);
  }

  if (!files.length) {
    await repo.updateProposal(proposal.id, { issues: issues.map((i) => i.number), error: "патча нет — только issues" });
    await repo.setFindingStatus(plan.used, "proposed", proposal.id);
    log("Патча нет — только issues.");
    return;
  }

  // ветка и коммит: только разрешённые файлы — проверяем по git status, а не по плану
  const branch = freeBranch(branchName(pair, new Date()));
  git("checkout", "-b", branch);
  for (const [p, text] of Object.entries(plan.files)) {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  const changed = changedPaths(execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "utf8" }));
  try {
    assertAllowedPatch(changed);
  } catch (e) {
    git("checkout", "--", ".");
    return fail(e instanceof Error ? e.message : String(e));
  }
  git("add", "--", ...changed);
  const msg = `quality: ${pair} — ${findings.length} находок из отзывов (${components.join(", ")})\n\nquality_proposals.${proposal.id}${RUN_URL ? `\n${RUN_URL}` : ""}`;
  git("-c", "user.name=kniga-semyi-quality", "-c", "user.email=quality-bot@users.noreply.github.com", "commit", "-m", msg);
  git("push", "-u", "origin", branch);
  log(`Ветка \`${branch}\` — ${changed.length} файлов`);

  const tokenNote = BOT_TOKEN
    ? undefined
    : "⚠️ PR открыт токеном GitHub Actions: проверки ci / e2e / flag-line / eval GitHub сам не запускает. Закройте и снова откройте PR — проверки пойдут (или заведите секрет QUALITY_BOT_TOKEN).";
  const body = proposalBody({ plan, findings, proposalId: proposal.id, issues, runUrl: RUN_URL, tokenNote });
  const title = `${opts.selftest ? "[самопроверка Q3] " : ""}[v2 Q] ${PAIR_RU[pair]}: ${findings.length} ${findings.length === 1 ? "находка" : "находок"} из отзывов → ${components.map((c) => COMPONENT_RU[c]).join(", ")}`;
  const pr = await gh<{ number: number; html_url: string }>("POST", "/pulls", { title: title.slice(0, 250), head: branch, base: "main", body });
  log(`PR #${pr.number}: ${pr.html_url}`);
  await repo.updateProposal(proposal.id, { branch, pr_number: pr.number, pr_url: pr.html_url, files: changed, issues: issues.map((i) => i.number), status: "eval" });
  await repo.setFindingStatus(plan.used, "proposed", proposal.id);
  log(`Предложение \`${proposal.id}\` → eval · находок в нём ${plan.used.length}`);
}

async function main() {
  // Только staging (§6): workflow передаёт только секреты STAGING_*.
  if (TARGET !== "staging") throw new Error("quality-propose работает только на staging (QUALITY_TARGET=staging)");
  if (!SB || !KEY) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY базы staging");
  if (!isQualityPair(PAIR)) throw new Error(`Неизвестная пара ${PAIR}`);
  const pair: QualityPair = PAIR;
  const db = createClient(SB, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const repo = new SupabaseDigestRepo(db);
  log(`### quality-propose: ${ACTION} · ${PAIR_RU[pair]} (staging)`);
  log("");

  if (ACTION === "digest" || ACTION === "selftest") {
    let linkId: string | undefined;
    if (ACTION === "selftest") {
      if (pair !== "ru-kk" && pair !== "ru-ko") throw new Error("selftest — только ru-kk или ru-ko");
      linkId = await selftestLink(db, pair);
      log(`Самопроверка: вымышленная ссылка \`${linkId.slice(0, 8)}\` с 3 правками носителя (готово).`);
    }
    const router = createRouter({ store: new SupabaseStore(db, "staging") });
    log(`Режим ИИ **${getAiMode()}** · лимит разбора $${digestDailyUsd()} за сутки`);
    const r = await runDigest({ repo, ai: router, trigger: ACTION === "selftest" ? "selftest" : "workflow", linkId, log: (l) => console.log(l) });
    log(`Разбор: **${r.status}** · текстов ${r.itemsAnalyzed} из ${r.itemsSeen} · новых находок **${r.findingsNew}**, слито ${r.findingsMerged} · вызовов ${r.calls} · $${r.costUsd.toFixed(4)}`);
    for (const e of r.errors) log(`- 🟡 ${e}`);
    if (ACTION === "digest") return;
    const mine = (await repo.findings({ pair, statuses: ["new"] })).filter((f: QualityFinding) => f.link_ids.includes(linkId!));
    log(`Находок этой ссылки: **${mine.length}**`);
    log("");
    if (!mine.length) {
      log("🟡 Разбор этой ссылки ничего не нашёл — предлагать нечего.");
      return;
    }
    await propose(repo, pair, { ids: mine.map((f) => f.id), selftest: true });
    return;
  }
  await propose(repo, pair, { ids: IDS, component: COMPONENT });
}

main()
  .catch((e) => {
    log(`🔴 ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    summary();
  });
