// Отчёт прогона в Markdown: eval/reports/<persona>-<дата>[-<профиль>].md (папка в .gitignore).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tally, type FactCheck, type FactStatus } from "./facts";
import type { QuestionOutcome, SimResult } from "./run";

export const REPORTS_DIR = path.join(process.cwd(), "eval", "reports");

const STATUS: Record<FactStatus, string> = { found: "✅ найден", distorted: "⚠️ искажён", lost: "❌ потерян" };
const OUTCOME: Record<QuestionOutcome, string> = {
  answered: "ответ принят",
  skipped: "пропущен",
  later: "отложен «позже»",
  offtopic: "ушёл в другую тему",
  not_finished: "не закончен",
};
const STOP: Record<NonNullable<SimResult["stoppedBy"]>, string> = {
  questions: "достигнут лимит вопросов",
  budget: "лимит запросов к ИИ",
  ai_unavailable: "ИИ недоступен",
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");

export function reportFileName(r: Pick<SimResult, "persona" | "behavior" | "startedAt">, explicitBehavior?: string): string {
  const date = r.startedAt.slice(0, 10);
  return `${r.persona.key}-${date}${explicitBehavior ? `-${explicitBehavior}` : ""}.md`;
}

function factsTable(inChapters: FactCheck[], inDialog: FactCheck[]): string[] {
  const rows = inChapters.map((c, i) => {
    const d = inDialog[i];
    const said = d ? (d.status === "found" ? "да" : d.status === "distorted" ? `искажён (${d.detail})` : "нет") : "—";
    return `| ${cell(c.fact)} | ${said} | ${STATUS[c.status]} | ${cell(c.detail)} |`;
  });
  return ["| Факт | Прозвучал в разговоре | В главах | Детали |", "| --- | --- | --- | --- |", ...rows];
}

export function renderReport(r: SimResult): string {
  const t = tally(r.factsInChapters);
  const td = tally(r.factsInDialog);
  const followups = r.questions.reduce((n, q) => n + q.followups, 0);
  const steps = Object.entries(r.aiCalls.byStep).map(([s, n]) => `${s} ${n}`).join(", ");
  const limit = Number.isFinite(r.aiCalls.limit) ? ` из ${r.aiCalls.limit}` : "";
  const lostInEditing = r.factsInChapters.filter((c, i) => c.status !== "found" && r.factsInDialog[i]?.status === "found");

  const out: string[] = [
    `# Симуляция интервью: ${r.persona.name} (${r.persona.key})`,
    "",
    `- Дата: ${r.startedAt}`,
    `- Режим ИИ: ${r.mode}${r.mode === "mock" ? " (заглушка: ответы и главы из fixtures, факты не показательны)" : ""}`,
    `- Профиль поведения: ${r.behavior ?? "—"}`,
    `- Запросов к ИИ: ${r.aiCalls.used}${limit} (${steps || "нет"})`,
    `- Окончание: ${r.stoppedBy ? `остановлено — ${STOP[r.stoppedBy]}${r.stopDetail ? ` (${r.stopDetail})` : ""}` : "интервью завершено агентом"}`,
    "",
    "## Итог",
    "",
    `- Вопросов задано: ${r.questions.length}, уточнений всего: ${followups}`,
    `- Ключевые факты в главах: найдено ${t.found}, искажено ${t.distorted}, потеряно ${t.lost} (из ${r.factsInChapters.length})`,
    `- Те же факты в самом разговоре: прозвучало ${td.found}, искажено ${td.distorted}, не прозвучало ${td.lost}`,
    `- Потеряно при сборке главы (в разговоре было, в главе нет): ${lostInEditing.length}`,
    "",
    "## Уточнения по вопросам",
    "",
    "| Вопрос | Блок | Уточнений | Исход |",
    "| --- | --- | --- | --- |",
    ...r.questions.map((q) => `| ${q.id}: ${cell(q.text)} | ${q.block} | ${q.followups} | ${OUTCOME[q.outcome]} |`),
    "",
    "## Ключевые факты",
    "",
    ...factsTable(r.factsInChapters, r.factsInDialog),
    "",
    "Сверка эвристическая (годы — точно, слова — по основе); спорные строки проверьте глазами.",
    "",
    "## Главы",
    "",
  ];

  if (r.chapters.length === 0) out.push("Глав нет — рассказчик не дал ни одного засчитанного ответа.", "");
  r.chapters.forEach((c, i) => {
    out.push(`### ${i + 1}. ${c.title ?? "(без названия)"} · ${c.block ?? "—"}${c.questionId ? ` · ${c.questionId}` : " · не по теме"}`, "");
    if (c.error) {
      out.push(`> Глава не собрана: ${c.error}`, "");
      return;
    }
    out.push("**RU**", "", c.text_ru ?? "", "", c.quote ? `> ${c.quote}` : "", "");
    out.push(`**KR — ${c.title_ko ?? ""}**`, "", c.text_ko ?? "", "", c.quote_ko ? `> ${c.quote_ko}` : "", "");
  });

  out.push("## Диалог", "");
  for (const turn of r.turns) {
    if (turn.role === "note") out.push(`_${turn.text}_`, "");
    else if (turn.role === "persona") out.push(`**${r.persona.name}:** ${turn.text}`, "");
    else out.push(`**Агент${turn.role === "followup" ? " (уточнение)" : ""}:** ${turn.text}`, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function writeReport(r: SimResult, opts: { dir?: string; explicitBehavior?: string } = {}): string {
  const dir = opts.dir ?? REPORTS_DIR;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, reportFileName(r, opts.explicitBehavior));
  writeFileSync(file, renderReport(r), "utf8");
  return file;
}
