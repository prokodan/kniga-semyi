"use client";
// Озвучка вопроса голосом браузера (ru-RU). На iOS звук возможен только после нажатия пользователя.

function ruVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "ru-RU" && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith("ru"));
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string, onEnd?: () => void): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ru-RU";
  u.rate = 0.9; // чуть медленнее — для старших
  const voice = ruVoice();
  if (voice) u.voice = voice;
  if (onEnd) {
    u.onend = onEnd;
    u.onerror = onEnd;
  }
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
