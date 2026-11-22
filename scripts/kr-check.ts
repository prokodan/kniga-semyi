// Проверка корейского (V2): демо-главы книги + банк вопросов. Логика — eval/kr-check.ts.
//   npx tsx scripts/kr-check.ts                     # правила + обратный перевод (провайдер — по ключам)
//   npx tsx scripts/kr-check.ts --no-ai             # только правила, бесплатно
//   npx tsx scripts/kr-check.ts --out r.md --json r.json --comment c.md --link <url>
// Провайдер обратного перевода: OPENAI_API_KEY → OpenAI (перевод в проде на Gemini — значит, другой провайдер);
// иначе GEMINI_API_KEY → Gemini Flash (другая модель); иначе mock. Принудительно: KR_CHECK_PROVIDER=openai|gemini|mock.
// Модели — из прода (KR_CHECK_ROUTES_FILE = JSON {step: providers[]} из ai_routes), иначе lib/ai/config.ts.
// Один запрос к ИИ на запуск (все тексты одним пакетом), ответ кэшируется в KR_CHECK_CACHE_FILE.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { BLOCKS } from "@/content/questions/blocks";
import { QUESTIONS } from "@/content/questions/bank";
import { EvalStore } from "@/eval/store";
import { backTranslate, checkItem, chooseBackMode, parseGlossary, renderKrReport, type KrFlag, type KrItem, type KrReport } from "@/eval/kr-check";
import { DEMO_STORIES } from "@/lib/book/pdf/demo";
import { createRouter } from "@/lib/ai/router";

for (const f of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), f);
  if (existsSync(p)) process.loadEnvFile(p);
}

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    json: { type: "string" },
    comment: { type: "string" },
    link: { type: "string" },
    "no-ai": { type: "boolean", default: false },
  },
});

function items(): KrItem[] {
  const chapters: KrItem[] = DEMO_STORIES.map((s, i) => ({
    id: `demo-${i + 1}`,
    kind: "chapter",
    label: `Глава ${i + 1} «${s.title}»`,
    block: s.block ?? undefined,
    text_ru: s.text_ru ?? "",
    text_ko: s.text_ko ?? "",
    quote_ko: s.quote_ko ?? undefined,
  }));
  const bank: KrItem[] = BLOCKS.map((b) => {
    const qs = QUESTIONS.filter((q) => q.block === b.id);
    return {
      id: `bank-${b.id}`,
      kind: "question",
      label: `Вопросы «${b.ru}» (${qs.length})`,
      block: b.id,
      text_ru: qs.map((q) => q.ru).join("\n"),
      text_ko: qs.map((q) => q.ko).join("\n"),
    };
  });
  return [...chapters, ...bank];
}

async function main() {
  const glossary = parseGlossary(readFileSync("docs/glossary.md", "utf8"));
  const all = items();
  const flags: KrFlag[] = all.flatMap((i) => checkItem(i, glossary));
  const mode = args["no-ai"] ? "mock" : chooseBackMode(process.env);

  let provider = "mock";
  let model = "mock";
  let aiError: string | undefined;
  const meaning: Record<string, number> = {};
  if (!args["no-ai"]) {
    const ai = createRouter({ store: new EvalStore({ cacheFile: process.env.KR_CHECK_CACHE_FILE, routesFile: process.env.KR_CHECK_ROUTES_FILE }), mode: () => mode });
    // Перегрузка модели (429 / 503) у бесплатного Gemini частая и короткая — до 4 попыток с паузой.
    const waitMs = Number(process.env.KR_CHECK_RETRY_WAIT_MS ?? 30_000);
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const r = await backTranslate(ai, all);
        flags.push(...r.flags);
        Object.assign(meaning, r.meaning);
        provider = r.provider;
        model = r.model;
        aiError = undefined;
        break;
      } catch (e) {
        aiError = (e as Error).message.replace(/\s+/g, " ").slice(0, 300);
        console.error(`Обратный перевод, попытка ${attempt}: ${aiError}`);
        if (!/rate_limited|timeout|429|503/.test(aiError) || attempt === 4) break;
        await new Promise((res) => setTimeout(res, waitMs * attempt));
      }
    }
  }

  const report: KrReport = {
    date: new Date().toISOString().slice(0, 10),
    mode,
    provider,
    model,
    aiError,
    items: all,
    flags,
    meaning,
    glossary: { total: glossary.length, confirmed: glossary.filter((g) => g.confirmed).length },
  };
  const md = renderKrReport(report, { link: args.link });
  const write = (file: string | undefined, text: string) => {
    if (!file) return;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write(args.out, md);
  write(args.json, JSON.stringify(report, null, 2));
  write(args.comment, renderKrReport(report, { link: args.link, marker: true }));
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
