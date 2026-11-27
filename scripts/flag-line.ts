// #223: CI-проверка строки «Флаг:» в описании PR (workflow flag-line).
// Вход — переменные окружения: PR_AUTHOR, PR_BODY, PR_FILES (пути через перевод строки).
// Выход: 0 — ок / пропуск, 1 — строки нет или флаг неизвестен (текст ошибки — в лог и в Summary).
import { appendFileSync } from "node:fs";
import { checkPullRequest } from "../lib/flags/line";
import { FLAG_NAMES } from "../lib/flags/registry";

const files = (process.env.PR_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const r = checkPullRequest({ author: process.env.PR_AUTHOR ?? "", body: process.env.PR_BODY, files }, FLAG_NAMES);

const line = r.ok
  ? r.kind === "skip"
    ? `⏭ flag-line: пропуск — ${r.reason}`
    : r.kind === "none"
      ? `✅ Флаг: не нужен — ${r.reason}`
      : `✅ Флаг: ${r.names.join(", ")}`
  : `🔴 ${r.error}`;

console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
if (!r.ok) {
  console.log(`::error title=flag-line::${r.error}`);
  process.exit(1);
}
