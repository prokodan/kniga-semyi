"use client";
// Озвучка вопроса голосом браузера (ru-RU). Во время записи озвучка заблокирована (#100): старт записи сам глушит
// её и ждёт тишины — см. components/recorder/silence.ts.
//
// #169: одна озвучка за раз.
//  - Перед любым speak — cancel; у каждого запуска свой номер: события старой фразы (onend / onerror после cancel)
//    новую не трогают.
//  - Автоозвучка нового вопроса (auto) того же текста не повторяется: эффект React может сработать дважды.
//  - Браузер может не дать звук без жеста пользователя (iOS Safari, Android Chrome): фраза тогда висит в очереди
//    и потом играет вместе с ручным нажатием — вопрос звучал дважды. Если автоозвучка не стартовала за
//    AUTO_START_MS — снимаем её из очереди и показываем «▶ Прослушать вопрос» (status = "blocked").
import { useSyncExternalStore } from "react";
import { isSpeechBlocked, onSpeechBlocked } from "@/components/recorder/silence";

/** Столько ждём старта автоозвучки, потом — кнопка «▶ Прослушать вопрос» */
export const AUTO_START_MS = 1000;
/** Повторное нажатие быстрее этого, пока фраза стартует, — то же нажатие (двойной тап) */
const DOUBLE_TAP_MS = 400;

export type SpeechStatus = "idle" | "starting" | "speaking" | "blocked";
export interface SpeechState {
  status: SpeechStatus;
  text: string | null;
}

const IDLE: SpeechState = { status: "idle", text: null };
let state: SpeechState = IDLE;
let gen = 0;
let startedAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: SpeechState) {
  state = next;
  for (const l of listeners) l();
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function ruVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "ru-RU" && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith("ru"));
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function getSpeechState(): SpeechState {
  return state;
}

/**
 * Озвучить текст. `auto: true` — автоозвучка нового вопроса (без жеста пользователя): не повторяется для того же
 * текста и через AUTO_START_MS без старта снимается из очереди → status "blocked". Без auto — нажатие кнопки.
 */
export function speak(text: string, opts: { auto?: boolean; onEnd?: () => void } = {}): void {
  if (!canSpeak() || isSpeechBlocked()) return; // идёт запись — вопрос не должен попасть в неё
  const same = state.text === text;
  if (opts.auto && same && state.status !== "idle") return; // уже звучит / стартует / показали кнопку — без повторов
  if (!opts.auto && same && state.status === "starting" && Date.now() - startedAt < DOUBLE_TAP_MS) return;

  const synth = window.speechSynthesis;
  const my = ++gen;
  clearTimer();
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ru-RU";
  u.rate = 0.9; // чуть медленнее — для старших
  const voice = ruVoice();
  if (voice) u.voice = voice;
  u.onstart = () => {
    if (my !== gen) return;
    clearTimer();
    set({ status: "speaking", text });
  };
  const done = () => {
    if (my === gen) {
      clearTimer();
      set({ status: "idle", text });
    }
    opts.onEnd?.();
  };
  u.onend = done;
  u.onerror = done;
  startedAt = Date.now();
  set({ status: "starting", text });
  synth.speak(u);
  if (synth.paused) synth.resume(); // Chrome иногда остаётся на паузе после cancel

  if (opts.auto) {
    timer = setTimeout(() => {
      timer = null;
      if (my !== gen || state.status !== "starting") return;
      if (synth.speaking && !synth.pending) return set({ status: "speaking", text }); // onstart не пришёл, но звучит
      synth.cancel(); // не дать ей заиграть позже вместе с ручным нажатием
      gen++;
      set({ status: "blocked", text });
    }, AUTO_START_MS);
  }
}

export function stopSpeaking(): void {
  gen++;
  clearTimer();
  if (canSpeak()) window.speechSynthesis.cancel();
  if (state.status !== "idle") set({ status: "idle", text: state.text });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Состояние озвучки для кнопки: blocked — автоозвучка не стартовала, показать «▶ Прослушать вопрос». */
export function useSpeechState(): SpeechState {
  return useSyncExternalStore(subscribe, getSpeechState, () => IDLE);
}

/** true, пока идёт запись: кнопку «Прослушать вопрос» делаем недоступной. */
export function useSpeechBlocked(): boolean {
  return useSyncExternalStore(onSpeechBlocked, isSpeechBlocked, () => false);
}
