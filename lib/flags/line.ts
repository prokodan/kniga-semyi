// #223: проверка строки «Флаг:» в описании PR (CI job flag-line, scripts/flag-line.ts). Чистая функция — есть тесты.
// Принимаем:   Флаг: <имя из lib/flags/registry.ts>[, <ещё имя>]
//              Флаг: не нужен — <причина>
// Комментарии шаблона <!-- … --> не считаются: пустой шаблон = красный.

export type FlagLineResult =
  | { ok: true; kind: "flags"; names: string[] }
  | { ok: true; kind: "none"; reason: string }
  | { ok: true; kind: "skip"; reason: string }
  | { ok: false; error: string };

const LINE = /^[ \t>]*(?:[-*+][ \t]+)?\**[ \t]*Флаг[ \t]*\**[ \t]*:[ \t]*\**(.*)$/gim;
const NOT_NEEDED = /^не[ \t]+нужен[ \t]*(?:[—–-]+|:)?[ \t]*(.*)$/i;

const HELP = "Добавьте в описание PR строку «Флаг: <имя из lib/flags/registry.ts>» или «Флаг: не нужен — <почему>» (docs/HANDOFF.md §3).";

function clean(s: string): string {
  return s.replace(/[`*]/g, "").trim();
}

export function checkFlagLine(body: string | null | undefined, known: readonly string[]): FlagLineResult {
  const text = (body ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const values = [...text.matchAll(LINE)].map((m) => clean(m[1] ?? "")).filter(Boolean);
  if (values.length === 0) return { ok: false, error: `Нет строки «Флаг: …». ${HELP}` };
  if (values.length > 1) return { ok: false, error: `Строк «Флаг:» несколько (${values.length}) — оставьте одну. ${HELP}` };
  const value = values[0]!;

  const none = NOT_NEEDED.exec(value);
  if (none) {
    const reason = clean(none[1] ?? "");
    if (reason.length < 3) return { ok: false, error: "«Флаг: не нужен» — без причины. Допишите: «Флаг: не нужен — багфикс / тексты / docs / инструменты команды»." };
    return { ok: true, kind: "none", reason };
  }

  const names = value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = names.filter((n) => !known.includes(n));
  if (unknown.length) {
    return {
      ok: false,
      error: `Флаг не найден в lib/flags/registry.ts: ${unknown.join(", ")}. Известные: ${known.join(", ") || "—"}. Новый флаг заводится строкой в реестре в этом же PR.`,
    };
  }
  return { ok: true, kind: "flags", names };
}

/** PR только про документацию: docs/** и *.md в корне. `prompts/*.md` — поведение ИИ, их это не касается. */
export function isDocsOnly(files: readonly string[]): boolean {
  return files.length > 0 && files.every((f) => f.startsWith("docs/") || /^[^/]+\.md$/.test(f));
}

/** Полная проверка PR: пропуск для Dependabot и docs-only, иначе — строка «Флаг:». */
export function checkPullRequest(input: { author: string; body: string | null | undefined; files: readonly string[] }, known: readonly string[]): FlagLineResult {
  if (/^dependabot(\[bot\])?$/i.test(input.author)) return { ok: true, kind: "skip", reason: "PR Dependabot" };
  if (isDocsOnly(input.files)) return { ok: true, kind: "skip", reason: "только документация" };
  return checkFlagLine(input.body, known);
}
