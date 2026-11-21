// Выбор формата записи. Safari (и все браузеры на iOS — это WebKit) пишут audio/mp4 (AAC),
// Chrome / Android — audio/webm;codecs=opus. Оба формата понимает расшифровка (Gemini / OpenAI).

const WEBKIT_ORDER = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm"];
const DEFAULT_ORDER = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];

/** iPhone / iPad / Safari на Mac: движок WebKit без Chromium. */
export function isAppleWebKit(ua: string, maxTouchPoints = 0): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1); // iPadOS выдаёт себя за Mac
  if (ios) return true;
  return /AppleWebKit/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua);
}

/** Первый поддерживаемый mime или "" (браузер выберет сам). */
export function pickMime(isSupported: (m: string) => boolean, appleWebKit: boolean): string {
  const order = appleWebKit ? WEBKIT_ORDER : DEFAULT_ORDER;
  return order.find((m) => isSupported(m)) ?? "";
}

export function browserMime(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return pickMime((m) => MediaRecorder.isTypeSupported(m), isAppleWebKit(navigator.userAgent, navigator.maxTouchPoints));
}

/** Тип блоба для загрузки: без параметров кодека; пустой → по движку. */
export function blobType(recorderMime: string, appleWebKit: boolean): string {
  const base = (recorderMime.split(";")[0] ?? "").trim();
  return base || (appleWebKit ? "audio/mp4" : "audio/webm");
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
