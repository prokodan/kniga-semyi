// #300 (флаг spoken_kk): расшифровка по языку рассказа. ru + корё мар (RU+KR) — вход, промпт и ключ кэша байт в байт
// как до #300; ru+kk / kk — prompts/transcribe.kk.md, казахские написания пакета kz, сверка не трогает казахские слова.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KZ_HINTS_KK, KZ_HINTS_RU, KZ_HINTS_RU_WORDS } from "@/content/packs/kz/pack";
import { promptPath, promptVariant } from "@/lib/ai/prompts";
import { transcribeModelBody } from "@/lib/ai/providers/gemini";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import { nameHints } from "@/lib/interview/names";
import type { SpokenLang, Story } from "@/lib/types";
import { MemoryPipelineRepo } from "./repo";
import { spokenInput, transcribe } from "./steps/transcribe";

function story(): Story {
  const now = new Date().toISOString();
  return {
    id: "story-1",
    family_id: "fam-1",
    storyteller_id: "st-1",
    session_id: null,
    parent_story_id: null,
    question_id: "childhood-01",
    block: "childhood",
    audio_url: "fam-1/story-1.webm",
    duration_sec: 300,
    transcript: null,
    text_ru: null,
    text_ko: null,
    title: null,
    title_ko: null,
    quote: null,
    quote_ko: null,
    facts: [],
    followups: [],
    status: "uploaded",
    error: null,
    sort_order: null,
    created_at: now,
    updated_at: now,
  };
}

async function run(opts: { spoken?: SpokenLang[]; flagOn?: boolean; heard?: string; packs?: string[] }) {
  const repo = new MemoryPipelineRepo();
  repo.names.set("st-1", "Жұмабеков Серік");
  repo.audio.set("fam-1/story-1.webm", { data: Buffer.from("fake-audio-bytes"), mimeType: "audio/webm;codecs=opus" });
  if (opts.spoken) repo.spoken.set("st-1", opts.spoken);
  repo.spokenKkOn = opts.flagOn ?? true;
  if (opts.packs) repo.nameHints = async () => nameHints({ storytellerName: "Жұмабеков Серік" }, opts.packs);
  const inputs: unknown[] = [];
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>): Promise<AiOutput<S>> {
      inputs.push(input);
      return { text: opts.heard ?? "Мы тогда жили в Уштабе.", language: "ru" } as unknown as AiOutput<S>;
    },
  };
  const patch = await transcribe({ story: story(), ai, repo, bank: null as never });
  return { input: inputs[0] as AiInput<"transcribe">, patch };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("расшифровка по языку рассказа (#300, флаг spoken_kk)", () => {
  it("RU+KR: prompts/transcribe.md не изменён ни на байт (версия промпта = ключ кэша)", () => {
    expect(sha(readFileSync("prompts/transcribe.md", "utf8"))).toBe("b5894a641a7330b3635aab22a22007c69dcd9146cfc4a1f521c16e4f3f88933e");
  });

  it("ru + корё мар, просто ru, флаг выключен — вход как до #300 (те же ключи в том же порядке, без spokenLangs)", async () => {
    const before = (i: AiInput<"transcribe">) =>
      JSON.stringify({ audioBase64: i.audioBase64, mimeType: i.mimeType, durationSec: i.durationSec, languageHint: "ru", hints: i.hints });
    for (const o of [{ spoken: ["ru", "koryo"] as SpokenLang[] }, { spoken: ["ru"] as SpokenLang[] }, {}, { spoken: ["ru", "kk"] as SpokenLang[], flagOn: false }]) {
      const { input, patch } = await run(o);
      expect(JSON.stringify(input)).toBe(before(input));
      expect(promptVariant("transcribe", input)).toBeUndefined();
      expect(path.basename(promptPath("transcribe", undefined, promptVariant("transcribe", input)))).toBe("transcribe.md");
      expect(patch.transcript).toBe("Мы тогда жили в Уштобе."); // сверка со словарём — как раньше
    }
  });

  it("ru+kk: transcribe.kk.md, mixed, казахские написания пакета kz вместо русских, семья — первой", async () => {
    const { input } = await run({ spoken: ["ru", "kk"], packs: ["general", "kz"] });
    expect(input.spokenLangs).toEqual(["ru", "kk"]);
    expect(input.languageHint).toBe("mixed");
    expect(path.basename(promptPath("transcribe", undefined, promptVariant("transcribe", input)))).toBe("transcribe.kk.md");
    expect(input.hints?.[0]).toBe("Жұмабеков Серік");
    for (const w of ["әже", "ата", "апа", "нағашы", "той", "дастарқан", "Үштөбе", "Қарағанды"]) expect(input.hints, w).toContain(w);
    for (const w of ["нагашы", "дастархан", "Желтоксан"]) expect(input.hints, w).not.toContain(w);
    expect(input.hints).not.toContain("соғыс"); // советские реалии — перевод, а не написание: русское «война» остаётся
    expect(input.hints!.length).toBeLessThanOrEqual(150);
  });

  it("kk: languageHint kk", async () => {
    const { input } = await run({ spoken: ["kk"] });
    expect(input).toMatchObject({ languageHint: "kk", spokenLangs: ["kk"] });
  });

  it("сверка со словарём не трогает казахские слова и казахские написания мест", async () => {
    const heard = "Мы в ауле жили, әжем дастарқан жайды, нағашы атам Үштөбеде тұрды. Потом в Уштабе переехали.";
    const { patch } = await run({ spoken: ["ru", "kk"], packs: ["general", "kz", "koryo"], heard });
    expect(patch.transcript).toBe(heard.replace("Уштабе", "Уштобе"));
  });

  it("spokenInput: без kk — null; русские написания казахских слов уходят из подсказок, русские топонимы остаются", () => {
    expect(spokenInput(["ru", "koryo"], ["Уштобе"])).toBeNull();
    expect(spokenInput(null, ["Уштобе"])).toBeNull();
    const hints = ["Серік", ...KZ_HINTS_RU];
    const s = spokenInput(["ru", "kk"], hints)!;
    expect(s.reconcile).toEqual(hints);
    for (const w of KZ_HINTS_RU_WORDS) expect(s.hints, w).not.toContain(w);
    expect(s.hints.slice(0, 2)).toEqual(["Серік", "Алматы"]);
    expect(s.hints).toContain("Уштобе");
    expect(s.hints).toContain("Үштөбе");
    expect(s.hints.length).toBeLessThanOrEqual(150);
  });

  it("Gemini: инструкция модели расшифровки без spokenLangs — как раньше; с kk — про казахские буквы", () => {
    const text = (b: unknown) => (b as { contents: { parts: { text?: string }[] }[] }).contents[0]!.parts[0]!.text!;
    expect(text(transcribeModelBody({ mimeType: "audio/webm", audioBase64: "AA", hints: ["Уштобе"] }))).toBe(
      "Расшифруй запись дословно, на языке речи (обычно русский, иногда слова на корё мар — пиши их кириллицей так, как звучат). " +
        "Только текст расшифровки, без пояснений. Имена, места и слова, которые могут прозвучать (пиши так): Уштобе.",
    );
    expect(text(transcribeModelBody({ mimeType: "audio/webm", audioBase64: "AA", spokenLangs: ["ru", "kk"] }))).toMatch(/казахской кириллицей/);
  });
});
