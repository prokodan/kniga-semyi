// #352: «Сгенерировать N» в /admin/quality — шаг ИИ quality_generate (самая сильная модель OpenAI по маршруту),
// параллельные вызовы по ≤ 2 штуки, чтобы уложиться в лимит функции 60 с. Результат — строки банка со статусом new,
// source=generated (черновик; дальше — прогон и проверка носителем).
import type { AiRouter, RunOptions } from "@/lib/ai/router";
import { cleanFocus, cleanTags, defaultPack, generateCalls, tagCounts, tagsForCall, wordCount } from "./core";
import type { QualityRepo } from "./repo";
import type { NuanceTag, QualityKind, QualityPair, QualityPersona } from "./types";

export interface GenerateRequest {
  kind: QualityKind;
  pair: QualityPair;
  n: number;
  tags: NuanceTag[];
  /** Текст — от лица этой личности; не задана — по кругу активные личности пары */
  personaId?: string;
}

export interface GenerateResult {
  added: number;
  failed: number;
  errors: string[];
}

export async function generateBank(
  repo: QualityRepo,
  ai: Pick<AiRouter, "run">,
  req: GenerateRequest,
  opts: Pick<RunOptions, "deadline"> = {},
): Promise<GenerateResult> {
  const [personas, texts] = await Promise.all([repo.personas(req.pair), repo.texts(req.pair)]);
  const live = personas.filter((p) => p.status !== "archived");
  const calls = generateCalls(req.n);
  const counts = tagCounts(texts);
  const avoid = (req.kind === "persona" ? personas.map((p) => p.name) : texts.map((t) => t.event)).filter(Boolean).slice(-60);

  let speakers: QualityPersona[] = [];
  if (req.kind === "text") {
    const chosen = req.personaId ? live.find((p) => p.id === req.personaId) : undefined;
    if (req.personaId && !chosen) return { added: 0, failed: calls.length, errors: ["Эта личность в архиве или не из этой пары."] };
    speakers = chosen ? [chosen] : live;
    if (!speakers.length) return { added: 0, failed: calls.length, errors: ["В паре нет активных личностей — сначала добавьте личность."] };
  }

  const results = await Promise.allSettled(
    calls.map(async (count, i) => {
      const who = speakers.length ? speakers[i % speakers.length]! : undefined;
      const out = await ai.run(
        "quality_generate",
        {
          kind: req.kind,
          pair: req.pair,
          count,
          nuance_tags: tagsForCall(req.tags, counts, i),
          pack: who?.pack ?? defaultPack(req.pair),
          ...(who ? { persona: { name: who.name, bio: who.bio.slice(0, 6000), speech_style: who.speech_style.slice(0, 1500) } } : {}),
          avoid,
          variant: i,
        },
        { noCache: true, ...opts },
      );
      let added = 0;
      if (req.kind === "persona") {
        for (const p of out.personas.slice(0, count)) {
          await repo.addPersona({ pair: req.pair, pack: defaultPack(req.pair), name: p.name.trim(), bio: p.bio.trim(), speech_style: p.speech_style.trim(), tags: cleanTags(p.tags), source: "generated" });
          added += 1;
        }
      } else {
        for (const t of out.texts.slice(0, count)) {
          const words = wordCount(t.text);
          if (words < 40 || words > 400) continue; // модель промахнулась с длиной — не в банк
          const tags = cleanTags(t.nuance_tags);
          await repo.addText({
            pair: req.pair,
            persona_id: who!.id,
            event: t.event.trim(),
            text_src: t.text.trim(),
            nuance_tags: tags.length ? tags : tagsForCall(req.tags, counts, i),
            focus_terms: cleanFocus(t.focus_terms, t.text),
            source: "generated",
          });
          added += 1;
        }
      }
      return added;
    }),
  );
  const res: GenerateResult = { added: 0, failed: 0, errors: [] };
  for (const r of results) {
    if (r.status === "fulfilled") res.added += r.value;
    else {
      res.failed += 1;
      res.errors.push((r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 200));
    }
  }
  return res;
}
