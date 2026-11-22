import "server-only";
// Режим сцены (I12): демо на полуфинале не падает ни при Wi-Fi, ни при лимите ИИ, ни при медленном ответе.
//
//   STAGE_MODE=1 → каждый шаг ИИ для ДЕМО-семьи ждёт ответа не дольше 20 с (STAGE_TIMEOUT_MS).
//   Не успел или упал — показываем заранее готовый результат этой демо-истории (fixtures/demo/family.ts),
//   в лог пишем «[stage] …». Настоящий ответ, если придёт позже, роутер всё равно положит в ai_cache.
//
// Только демо: истории семей из DEMO_FAMILY_IDS (по storyId) и сказка / картинки демо (по входу шага).
// Настоящим семьям чужой текст не подставляем никогда — для них withStageFallback просто вызывает fn().
// Подключено одной строкой в lib/ai/index.ts: ai.run(...) → withStageFallback(opts.storyId, step, …).
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import type { LifeBlock } from "@/lib/types";
import {
  DEMO_FAMILY_IDS,
  DEMO_KIOSK_STORY,
  DEMO_STAGE_RESERVE,
  DEMO_STORY_SEEDS,
  DEMO_STORYTELLER,
  DEMO_TALE,
  followupStoryId,
  type DemoStorySeed,
} from "@/fixtures/demo/family";
import { DEMO_TALE_ART } from "@/fixtures/demo/tale-art";

export const STAGE_TIMEOUT_MS = 20_000;
/** Поиск истории в базе не должен съедать время сцены. */
const LOOKUP_TIMEOUT_MS = 2_000;

export function isStageMode(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test((env.STAGE_MODE ?? "").trim());
}

/** Что нужно знать об истории, чтобы выбрать готовый результат. */
export interface StageStoryRef {
  family_id: string;
  question_id: string | null;
  block: LifeBlock | null;
  parent_story_id: string | null;
}
export type StageLookup = (storyId: string) => Promise<StageStoryRef | null>;

type Seed = Pick<DemoStorySeed, "question_id" | "block" | "transcript" | "edit" | "translate"> & {
  followups?: DemoStorySeed["followups"];
};

const SEEDS: DemoStorySeed[] = [...DEMO_STORY_SEEDS, DEMO_KIOSK_STORY];
const DEMO_FAMILIES = new Set<string>(DEMO_FAMILY_IDS);

/** История демо по фиксированному ID; followup — запись-уточнение (тогда расшифровка = ответ на уточнение). */
function seedById(storyId: string): { seed: Seed; followup: number | null } | null {
  const main = SEEDS.find((s) => s.id === storyId);
  if (main) return { seed: main, followup: null };
  for (const [i, s] of DEMO_STORY_SEEDS.entries()) {
    const f = s.followups.findIndex((_, j) => followupStoryId(i, j) === storyId);
    if (f >= 0) return { seed: s, followup: f };
  }
  return null;
}

/** Новая запись демо-семьи (например, на сцене): тот же вопрос → тот же блок → запас «Трудные времена» → первая глава. */
function seedByQuestion(questionId: string | null, block: LifeBlock | null): Seed {
  const all: Seed[] = [...DEMO_STORY_SEEDS, DEMO_STAGE_RESERVE];
  return (
    all.find((s) => questionId && s.question_id === questionId) ??
    all.find((s) => block && s.block === block) ??
    DEMO_STORY_SEEDS[0]!
  );
}

function outputFor(step: AiStep, seed: Seed, followup: number | null, input: unknown): unknown {
  switch (step) {
    case "transcribe": {
      const text = followup !== null ? (seed.followups?.[followup]?.answer ?? seed.transcript) : seed.transcript;
      return { text, language: "ru" };
    }
    case "edit":
      return seed.edit;
    case "translate":
      return seed.translate;
    case "completeness": {
      // Первое уточнение — как в демо-интервью, дальше ответ принимаем: сцена не застревает на вопросах.
      const i = input as Partial<AiInput<"completeness">>;
      const q = seed.followups?.[0]?.question;
      if ((i.followupsAsked ?? 0) === 0 && q) {
        return { covered: [], missing: (i.minimum ?? []).slice(-1), followup: q, done: false, offTopicBlock: null };
      }
      return { covered: i.minimum ?? [], missing: [], followup: null, done: true, offTopicBlock: null };
    }
    default:
      return null; // next_question: интервью-агент сам идёт по банку, когда ИИ недоступен
  }
}

/** Сказка и картинки демо узнаются по входу шага (у них нет storyId). */
function preparedByInput(step: AiStep, input: unknown): unknown {
  if (step === "tale") {
    const i = input as Partial<AiInput<"tale">>;
    const demoTitles = new Set(DEMO_STORY_SEEDS.map((s) => s.edit.title));
    const stories = i.stories ?? [];
    if (i.storytellerName === DEMO_STORYTELLER.name && stories.length > 0 && stories.every((s) => demoTitles.has(s.title))) return DEMO_TALE;
    return null;
  }
  if (step === "illustrate") {
    const prompt = (input as Partial<AiInput<"illustrate">>).prompt;
    const page = DEMO_TALE.pages.findIndex((p) => p.illustrationPrompt === prompt);
    if (page < 0) return null;
    return { imageBase64: Buffer.from(DEMO_TALE_ART[page]!).toString("base64"), mimeType: "image/svg+xml" };
  }
  return null;
}

/**
 * Готовый результат шага для демо или null (не демо / для шага его нет).
 * Чистая функция поверх lookup — её проверяют тесты.
 */
export async function preparedResult<S extends AiStep>(
  step: S,
  storyId: string | null | undefined,
  input: unknown,
  lookup: StageLookup = dbLookup,
): Promise<AiOutput<S> | null> {
  let out: unknown = null;
  if (storyId) {
    const byId = seedById(storyId);
    if (byId) out = outputFor(step, byId.seed, byId.followup, input);
    else {
      const ref = await lookup(storyId).catch(() => null);
      if (ref && DEMO_FAMILIES.has(ref.family_id)) {
        // Уточнение к новой записи: расшифровка — ответ на первое уточнение подходящей демо-истории.
        out = outputFor(step, seedByQuestion(ref.question_id, ref.block), ref.parent_story_id ? 0 : null, input);
      }
    }
  }
  if (out === null) out = preparedByInput(step, input);
  return out === null ? null : (structuredClone(out) as AiOutput<S>);
}

const lookupCache = new Map<string, StageStoryRef | null>();

async function dbLookup(storyId: string): Promise<StageStoryRef | null> {
  if (lookupCache.has(storyId)) return lookupCache.get(storyId)!;
  const { getDbOrNull } = await import("@/lib/db");
  const db = getDbOrNull();
  if (!db) return null;
  const query = db.from("stories").select("family_id, question_id, block, parent_story_id").eq("id", storyId).maybeSingle();
  const res = await Promise.race([
    Promise.resolve(query).then((r) => (r.error ? null : ((r.data as StageStoryRef | null) ?? null))),
    sleep(LOOKUP_TIMEOUT_MS).then(() => null),
  ]);
  if (res) lookupCache.set(storyId, res);
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, Math.max(0, ms));
    (t as { unref?: () => void }).unref?.();
  });
}

export interface StageOptions {
  input?: unknown;
  timeoutMs?: number;
  lookup?: StageLookup;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
}

/**
 * Обёртка шага ИИ для сцены. Вне STAGE_MODE и для не-демо — ровно fn().
 * В STAGE_MODE для демо: ответ fn() за timeoutMs (20 с) → он; дольше или ошибка → готовый результат + «[stage]» в лог.
 */
export async function withStageFallback<S extends AiStep>(
  storyId: string | null | undefined,
  step: S,
  fn: () => Promise<AiOutput<S>>,
  opts: StageOptions = {},
): Promise<AiOutput<S>> {
  if (!isStageMode(opts.env)) return fn();
  const deadline = Date.now() + (opts.timeoutMs ?? STAGE_TIMEOUT_MS);
  const live = fn();
  live.catch(() => undefined); // проигравший гонку промис не должен ронять процесс

  const prepared = await preparedResult(step, storyId, opts.input, opts.lookup).catch(() => null);
  if (!prepared) return live;

  const log = opts.log ?? ((m: string) => console.warn(m));
  const outcome = await Promise.race([
    live.then(
      (value) => ({ kind: "ok" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
    sleep(deadline - Date.now()).then(() => ({ kind: "timeout" as const })),
  ]);
  if (outcome.kind === "ok") return outcome.value;
  const reason =
    outcome.kind === "timeout"
      ? `нет ответа за ${Math.round((opts.timeoutMs ?? STAGE_TIMEOUT_MS) / 1000)} с`
      : outcome.error instanceof Error
        ? `${outcome.error.name}: ${outcome.error.message.slice(0, 200)}`
        : "ошибка";
  log(`[stage] ${step} story=${storyId ?? "-"}: ${reason} → заранее готовый результат демо`);
  return prepared;
}
