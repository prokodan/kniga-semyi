// Проверки текста интервью-агента и сказки — без ИИ, бесплатно (V1-2).
//   • уточнения (completeness.followup): длина, один вопрос, на «вы», не «расскажите подробнее», без повторов,
//     без давления после отказа или боли, которые не поймал detectSignal;
//   • связки (next_question.bridge): длина, без вопроса и лести, без повторов;
//   • сказка (tale): 4 страницы, короткие фразы для 5–10 лет, ничего страшного, нет чужих годов и имён,
//     финал «твой дедушка / твоя бабушка».
// Эвристики: флажок — повод посмотреть глазами в отчёте, а не приговор.
import type { AiOutput } from "@/lib/ai/types";
import type { SimResult } from "./sim/run";

export interface TextIssue {
  /** Текст агента / страницы сказки */
  text: string;
  issue: string;
}

const words = (s: string) => s.toLowerCase().match(/[а-яёa-z0-9-]+/gi) ?? [];
const stems = (s: string) => new Set(words(s).filter((w) => w.length >= 3).map((w) => w.slice(0, 5)));

/** Похожесть двух фраз по основам слов (Жаккар). */
export function similarity(a: string, b: string): number {
  const x = stems(a);
  const y = stems(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const s of x) if (y.has(s)) common += 1;
  return common / (x.size + y.size - common);
}

const REPEAT_SIMILARITY = 0.6;

// ---------------- уточнения и связки ----------------

/** Отказ / боль в ответе — уточнять нельзя. Шире, чем detectSignal движка: ловим вежливые и частичные формы. */
const NO_PRESSURE = [
  /не\s+хочу/i,
  /не\s+буду/i,
  /не\s+надо\s+(об|про)/i,
  /давайте\s+(о\s+другом|дальше|пропустим)/i,
  /не\s+для\s+книги/i,
  /не\s+помню\s+и\s+не\s+надо/i,
  /не\s+спрашивайте/i,
  /не\s+могу/i,
  /тяжело/i,
  /\((плачет|плач|пауза|молчит|всхлип\w*|вздыхает)\)/i,
  /(^|\s)извините[.…,]*\s*$/i,
];
export const isNoPressure = (answer: string) => NO_PRESSURE.some((r) => r.test(answer));

const GENERIC = /(расскажите|поделитесь)\s+(об\s+этом\s+|про\s+это\s+|ещё\s+)?(подробнее|поподробнее|побольше|больше)|что\s+ещё\s+(вы\s+)?(помните|можете\s+рассказать)/i;
const INFORMAL = /(^|[^а-яё])(ты|тебя|тебе|тобой|твой|твоя|твои|твоё|твоего|скажи|расскажи|помнишь)([^а-яё]|$)/i;
const FLATTERY = /(прекрасн|замечательн|великолепн|потрясающ|удивительн|чудесн)[а-яё]*\s+(рассказ|рассказыва|память|помните)|как\s+(хорошо|здорово)\s+вы\s+(рассказ|помн)/i;

/** Фиксированные фразы движка (lib/interview/engine.ts) — не ответ модели, не проверяем. */
const ENGINE_BRIDGES = [/^Хорошо, не будем об этом/, /^Спасибо, что поделились этим\. Давайте немного передохнём/];
const ENGINE_FOLLOWUP = /^Какая история!/;

export interface DialogueChecks {
  followups: number;
  followupIssues: TextIssue[];
  /** Уточнение сразу после отказа / боли */
  pressure: number;
  bridges: number;
  bridgeIssues: TextIssue[];
  /** Все уточнения и связки модели — чтобы оценить тон глазами */
  followupTexts: string[];
  bridgeTexts: string[];
  /**
   * #282: уточнения и связки с реалиями чужого пакета (персонажу без koryo — кукси, хальмони; без kz — Наурыз, жайлау),
   * которых рассказчик сам не называл. undefined — у персонажа нет строки «пакеты:» (банк V0, проверка не нужна).
   */
  foreignRealia?: TextIssue[];
}

// ---------------- #282: чужие реалии ----------------

/** Корё-реалии — только у пакета koryo (тот же список, что KORYO_REALIA в content/packs/culture.test.ts, без «1937»). */
export const KORYO_REALIA =
  /корё|корейск|чимчи|кукси|асянди|хвангаб|ханщи|хансик|хальмони|харабо[дч]|аппади|омани|пигоди/iu;
/** Казахские реалии — только у пакета kz (KZ_REALIA в content/packs/culture.test.ts). */
export const KZ_REALIA = /наурыз|жеті\s*ата|нағашы|жайлау|(^|[^\p{L}])жуз(?!\p{L})|ашаршылық|желтоқсан|бесбармак|(^|[^\p{L}])той(?!\p{L})/iu;

const REALIA_BY_PACK: { pack: string; re: RegExp; label: string }[] = [
  { pack: "koryo", re: KORYO_REALIA, label: "корё" },
  { pack: "kz", re: KZ_REALIA, label: "казахская" },
];

/**
 * #282: чужая реалия в тексте агента — слово пакета, которого у персонажа нет, и рассказчик сам его не произносил
 * (повторить за рассказчиком — можно). Пустой массив — всё в порядке.
 */
export function foreignRealiaIssues(text: string, packs: readonly string[], personaSaid: string): string[] {
  const out: string[] = [];
  for (const { pack, re, label } of REALIA_BY_PACK) {
    if (packs.includes(pack)) continue;
    const m = re.exec(text);
    if (!m) continue;
    const word = m[0].replace(/^[^\p{L}]+/u, "");
    if (re.test(personaSaid) && personaSaid.toLowerCase().includes(word.toLowerCase())) continue;
    out.push(`чужие реалии: ${label} «${word}» — у персонажа пакеты ${packs.join(" + ")}`);
  }
  return out;
}

export function checkFollowup(text: string, previous: string[]): string[] {
  const out: string[] = [];
  const n = words(text).length;
  if (n > 15) out.push(`длинное: ${n} слов (> 15)`);
  if ((text.match(/\?/g) ?? []).length > 1) out.push("два вопроса в одном");
  if (INFORMAL.test(text)) out.push("на «ты»");
  if (GENERIC.test(text)) out.push("общее «расскажите подробнее»");
  if (previous.some((p) => similarity(p, text) >= REPEAT_SIMILARITY)) out.push("повтор прошлого уточнения");
  return out;
}

export function checkBridge(text: string, previous: string[]): string[] {
  const out: string[] = [];
  const n = words(text).length;
  if (n > 12) out.push(`длинная: ${n} слов (> 12)`);
  if (text.includes("?")) out.push("вопрос в связке");
  if (FLATTERY.test(text)) out.push("лесть");
  if (previous.some((p) => similarity(p, text) >= REPEAT_SIMILARITY)) out.push("повтор прошлой связки");
  return out;
}

/**
 * Уточнения и связки агента из диалога симуляции. packs (#282) — пакеты персонажа: тогда ещё и «чужие реалии»;
 * без packs (kim, pak, tsoi — банк V0) поле foreignRealia не появляется и отчёт прежний.
 */
export function checkDialogue(sim: Pick<SimResult, "turns" | "questions">, packs?: readonly string[]): DialogueChecks {
  const qText = new Map(sim.questions.map((q) => [q.id, q.text]));
  const res: DialogueChecks = { followups: 0, followupIssues: [], pressure: 0, bridges: 0, bridgeIssues: [], followupTexts: [], bridgeTexts: [] };
  const foreign: TextIssue[] = [];
  const said: string[] = [];
  const realia = (text: string) => {
    if (packs) for (const issue of foreignRealiaIssues(text, packs, said.join("\n"))) foreign.push({ text, issue });
  };
  const prevFollowups: string[] = [];
  const prevBridges: string[] = [];
  let lastAnswer = "";
  for (const t of sim.turns) {
    if (t.role === "persona") {
      lastAnswer = t.text;
      said.push(t.text);
      continue;
    }
    if (t.role === "followup") {
      if (ENGINE_FOLLOWUP.test(t.text)) continue;
      res.followups += 1;
      realia(t.text);
      const issues = checkFollowup(t.text, prevFollowups);
      if (isNoPressure(lastAnswer)) {
        res.pressure += 1;
        issues.push(`давление: уточнение после «${lastAnswer.slice(0, 60)}»`);
      }
      for (const issue of issues) res.followupIssues.push({ text: t.text, issue });
      prevFollowups.push(t.text);
      res.followupTexts.push(t.text);
      continue;
    }
    if (t.role === "agent" && t.questionId) {
      const q = qText.get(t.questionId) ?? "";
      if (!q || t.text === q || !t.text.endsWith(q)) continue;
      const bridge = t.text.slice(0, t.text.length - q.length).trim();
      if (!bridge || ENGINE_BRIDGES.some((r) => r.test(bridge))) continue;
      res.bridges += 1;
      realia(bridge);
      for (const issue of checkBridge(bridge, prevBridges)) res.bridgeIssues.push({ text: bridge, issue });
      prevBridges.push(bridge);
      res.bridgeTexts.push(bridge);
    }
  }
  return packs ? { ...res, foreignRealia: foreign } : res;
}

// ---------------- сказка ----------------

export const TALE_PAGES = 4;
const TALE_MAX_SENTENCES = 4;
const TALE_MAX_WORDS = 18;
const SCARY = /войн|депортац|переселен|выселен|голод|умер|умир|смерт|похорон|болезн|заболел|погиб|ссылк|расстрел|арест|лагер|сирот|кров/i;
const FINALE = /тво(й|я|его|ему|ей|ю)\s+(пра)?(дедушк|бабушк|дед|хальмони|харабод|харабоч)/i;
const YEAR = /(?<!\d)(1[89]\d\d|20\d\d)(?!\d)/g;
/** Слова, которые в сказке пишут с большой буквы и без опоры на главы. */
const TALE_OK = new Set(["дедуш", "бабуш", "мама", "папа", "ветер", "солнц", "луна", "звезд", "звёзд", "кот", "котик", "река", "речка"]);

export interface TaleChecks {
  title: string;
  pages: string[];
  issues: TextIssue[];
}

const sentences = (s: string) => s.split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);

/** Имена и места в середине предложения (с большой буквы), которых нет в главах. */
function strangers(text: string, source: string): string[] {
  const known = stems(source);
  // Короткие имена склоняются в пятой букве («Елена» → «Елене»): для них хватает основы из 4 букв.
  const known4 = new Set(words(source).filter((w) => w.length >= 3).map((w) => w.slice(0, 4)));
  const out = new Set<string>();
  for (const sent of sentences(text)) {
    const tokens = sent.split(/\s+/).slice(1);
    for (const raw of tokens) {
      const w = raw.replace(/^[«"„(—-]+|[»"“).,!?…:;—-]+$/g, "");
      if (!/^[А-ЯЁ][а-яё-]{2,}$/.test(w)) continue;
      const s = w.toLowerCase().slice(0, 5);
      if (known.has(s) || (w.length <= 6 && known4.has(s.slice(0, 4))) || TALE_OK.has(s) || TALE_OK.has(s.slice(0, 4))) continue;
      out.add(w);
    }
  }
  return [...out];
}

export function checkTale(tale: AiOutput<"tale">, source: { storytellerName: string; stories: { title: string; text_ru: string }[] }): TaleChecks {
  const pages = tale.pages.map((p) => p.text.trim());
  const issues: TextIssue[] = [];
  const src = [source.storytellerName, ...source.stories.map((s) => `${s.title}\n${s.text_ru}`)].join("\n");
  const srcYears = new Set(src.match(YEAR) ?? []);
  if (pages.length !== TALE_PAGES) issues.push({ text: tale.title, issue: `страниц ${pages.length}, нужно ${TALE_PAGES}` });
  pages.forEach((p, i) => {
    const label = `стр. ${i + 1}`;
    const ss = sentences(p);
    if (ss.length > TALE_MAX_SENTENCES) issues.push({ text: p, issue: `${label}: ${ss.length} предложений (> ${TALE_MAX_SENTENCES})` });
    const long = ss.map((s) => words(s).length).filter((n) => n > TALE_MAX_WORDS);
    if (long.length) issues.push({ text: p, issue: `${label}: длинное предложение ${Math.max(...long)} слов (> ${TALE_MAX_WORDS})` });
    const scary = p.match(SCARY);
    if (scary) issues.push({ text: p, issue: `${label}: страшное / грустное «${scary[0]}…»` });
    for (const y of p.match(YEAR) ?? []) if (!srcYears.has(y)) issues.push({ text: p, issue: `${label}: год ${y}, которого нет в главах` });
    const st = strangers(p, src);
    if (st.length) issues.push({ text: p, issue: `${label}: нет в главах — ${st.join(", ")}` });
    if (/[a-z]{3,}/i.test(p) && !/[а-яё]/i.test(p)) issues.push({ text: p, issue: `${label}: текст не по-русски` });
  });
  const last = pages.at(-1);
  if (last !== undefined && !FINALE.test(last)) issues.push({ text: last, issue: "финал без «твой дедушка / твоя бабушка»" });
  for (const [i, p] of tale.pages.entries()) {
    if (/[а-яё]/i.test(p.illustrationPrompt)) issues.push({ text: p.illustrationPrompt, issue: `стр. ${i + 1}: illustrationPrompt не на английском` });
  }
  return { title: tale.title, pages, issues };
}

/** Главы для сказки — как в lib/tale/pick: «сказочные» блоки первыми, по одной из блока, 2–5, текст ≤ 1800 знаков. */
const TALE_BLOCK_ORDER = ["childhood", "traditions", "roots", "youth", "love", "work", "legacy", "hardship"];
export function pickTaleChapters<T extends { block: string | null; title?: string; text_ru?: string }>(chapters: T[], max = 5): { title: string; text_ru: string }[] {
  const rank = (b: string | null) => {
    const i = TALE_BLOCK_ORDER.indexOf(b ?? "");
    return i === -1 ? TALE_BLOCK_ORDER.length : i;
  };
  const ready = chapters.filter((c) => c.text_ru?.trim()).sort((a, b) => rank(a.block) - rank(b.block));
  const seen = new Set<string>();
  const first: T[] = [];
  const rest: T[] = [];
  for (const c of ready) {
    const key = c.block ?? "none";
    (seen.has(key) ? rest : first).push(c);
    seen.add(key);
  }
  return [...first, ...rest].slice(0, max).map((c) => {
    const text = c.text_ru!.trim();
    return { title: c.title?.trim() || "Из жизни", text_ru: text.length > 1800 ? `${text.slice(0, 1800)}…` : text };
  });
}
