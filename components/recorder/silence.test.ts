// #100: старт записи глушит озвучку вопроса и ждёт фактической тишины; во время записи speak() молчит.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSpeechBlocked, onSpeechBlocked, setSpeechBlocked, silenceSpeech } from "./silence";

/** Поддельный speechSynthesis: как на iOS, после cancel() ещё stopAfter мс «говорит». */
function fakeSynth(stopAfter: number) {
  const s = {
    speaking: false,
    pending: false,
    cancels: 0,
    spoken: [] as string[],
    cancel() {
      s.cancels += 1;
      if (s.speaking) setTimeout(() => (s.speaking = false), stopAfter);
    },
    speak(u: { text: string }) {
      s.spoken.push(u.text);
      s.speaking = true;
    },
    getVoices: () => [],
  };
  return s;
}

const g = globalThis as unknown as { window?: unknown; SpeechSynthesisUtterance?: unknown };

describe("silence: озвучка не попадает в запись", () => {
  let synth: ReturnType<typeof fakeSynth>;
  beforeEach(() => {
    synth = fakeSynth(120);
    g.window = { speechSynthesis: synth };
    g.SpeechSynthesisUtterance = class {
      lang = "";
      rate = 1;
      voice: unknown;
      onend: unknown;
      onerror: unknown;
      constructor(public text: string) {}
    };
  });
  afterEach(() => {
    setSpeechBlocked(false);
    delete g.window;
    delete g.SpeechSynthesisUtterance;
  });

  it("тишина — без задержки", async () => {
    const t0 = Date.now();
    await silenceSpeech();
    expect(Date.now() - t0).toBeLessThan(50);
    expect(synth.cancels).toBe(1);
  });

  it("идёт озвучка — ждём фактической остановки (iOS) + страховка 300 мс", async () => {
    synth.speaking = true;
    const t0 = Date.now();
    await silenceSpeech();
    const waited = Date.now() - t0;
    expect(synth.speaking).toBe(false);
    expect(waited).toBeGreaterThanOrEqual(120 + 300 - 5);
    expect(waited).toBeLessThan(1500 + 400);
  });

  it("не замолкает — не ждём дольше лимита", async () => {
    synth.speaking = true;
    synth.cancel = () => {
      synth.cancels += 1; // «зависший» синтезатор
    };
    const t0 = Date.now();
    await silenceSpeech({ maxWaitMs: 200, safetyMs: 10 });
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it("во время записи speak() молчит, подписчики узнают о блокировке", async () => {
    const { speak } = await import("@/app/(family)/_ui/speak");
    const seen: boolean[] = [];
    const off = onSpeechBlocked((b) => seen.push(b));
    setSpeechBlocked(true);
    expect(isSpeechBlocked()).toBe(true);
    speak("Где вы родились?");
    expect(synth.spoken).toEqual([]);
    setSpeechBlocked(false);
    speak("Где вы родились?");
    expect(synth.spoken).toEqual(["Где вы родились?"]);
    off();
    expect(seen).toEqual([true, false]);
  });
});
