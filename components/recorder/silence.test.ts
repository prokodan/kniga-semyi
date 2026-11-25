// #100: старт записи глушит озвучку вопроса и ждёт фактической тишины; во время записи speak() молчит.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("speak: одна озвучка за раз (#169)", () => {
  let synth: ReturnType<typeof fakeSynth>;
  beforeEach(async () => {
    synth = fakeSynth(0);
    g.window = { speechSynthesis: synth };
    g.SpeechSynthesisUtterance = class {
      lang = "";
      rate = 1;
      voice: unknown;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    };
    setSpeechBlocked(false);
    (await import("@/app/(family)/_ui/speak")).stopSpeaking();
    synth.spoken = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("автоозвучка того же вопроса не повторяется (эффект сработал дважды)", async () => {
    const { speak } = await import("@/app/(family)/_ui/speak");
    speak("Где вы родились?", { auto: true });
    speak("Где вы родились?", { auto: true });
    expect(synth.spoken).toEqual(["Где вы родились?"]);
  });

  it("автоозвучка не стартовала за 1 с — снимается из очереди, кнопка «▶ Прослушать», ручное нажатие звучит один раз", async () => {
    const { speak, getSpeechState, AUTO_START_MS } = await import("@/app/(family)/_ui/speak");
    synth.speak = (u: { text: string }) => {
      synth.spoken.push(u.text);
      synth.pending = true; // браузер держит фразу в очереди до жеста пользователя
    };
    speak("Кем вы работали?", { auto: true });
    const cancelsBefore = synth.cancels;
    vi.advanceTimersByTime(AUTO_START_MS + 10);
    expect(synth.cancels).toBe(cancelsBefore + 1); // очередь очищена — не заиграет вместе с ручной
    expect(getSpeechState()).toEqual({ status: "blocked", text: "Кем вы работали?" });
    // повторная автоозвучка того же вопроса — без повторов
    speak("Кем вы работали?", { auto: true });
    expect(synth.spoken).toEqual(["Кем вы работали?"]);
    // нажатие кнопки — одна новая фраза, перед ней cancel
    speak("Кем вы работали?");
    expect(synth.spoken).toEqual(["Кем вы работали?", "Кем вы работали?"]);
    expect(getSpeechState().status).toBe("starting");
  });

  it("двойной тап по кнопке не запускает вопрос дважды", async () => {
    const { speak } = await import("@/app/(family)/_ui/speak");
    speak("Как звали маму?");
    speak("Как звали маму?");
    expect(synth.spoken).toEqual(["Как звали маму?"]);
  });

  it("события старой фразы после cancel не сбивают новую", async () => {
    const { speak, getSpeechState } = await import("@/app/(family)/_ui/speak");
    const made: { onstart: (() => void) | null; onerror: (() => void) | null }[] = [];
    const Base = g.SpeechSynthesisUtterance as new (t: string) => { onstart: (() => void) | null; onerror: (() => void) | null };
    g.SpeechSynthesisUtterance = class extends Base {
      constructor(t: string) {
        super(t);
        made.push(this);
      }
    };
    speak("Первый вопрос", { auto: true });
    speak("Второй вопрос", { auto: true });
    made[1]!.onstart?.();
    made[0]!.onerror?.(); // «interrupted» от первой — пришло позже
    expect(getSpeechState()).toEqual({ status: "speaking", text: "Второй вопрос" });
  });
});

