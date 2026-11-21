// QR главы (I3): подпись публичной ссылки на голос и QR в SVG.
// /listen/<storyId>?s=<подпись> открывается без токена семьи и только для этой истории.
// Подпись — HMAC-SHA256(storyId), первые 16 байт в base64url (22 символа — QR остаётся крупным и читается со слайда).
// Секрет: LISTEN_SECRET, иначе выводится из SUPABASE_SERVICE_ROLE_KEY (ничего не нужно заводить руками),
// без Supabase — локальный секрет (режим mock / тесты).
// Здесь нет server-only, чтобы функции тестировались напрямую; секрет читается только на сервере.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { env } from "@/lib/env";

const SIG_BYTES = 16;
const SIG_RE = /^[A-Za-z0-9_-]{22}$/;

function secret(): string {
  const explicit = env.listenSecret();
  if (explicit) return explicit;
  const service = env.supabaseServiceRoleKey();
  if (service) return createHash("sha256").update(`kniga-semyi:listen:v1:${service}`).digest("hex");
  return "kniga-semyi-local-listen-secret";
}

function mac(storyId: string, key: string): Buffer {
  return createHmac("sha256", key).update(`listen:${storyId}`).digest().subarray(0, SIG_BYTES);
}

/** Подпись ссылки на голос истории. */
export function signListen(storyId: string, key = secret()): string {
  return mac(storyId, key).toString("base64url");
}

/** Проверка подписи (в постоянное время). Любая ошибка формата → false. */
export function verifyListen(storyId: string, sig: string | null | undefined, key = secret()): boolean {
  if (!sig || !SIG_RE.test(sig) || !storyId) return false;
  const given = Buffer.from(sig, "base64url");
  const expected = mac(storyId, key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Путь публичной страницы голоса: /listen/<id>?s=<подпись> */
export function listenPath(storyId: string, key?: string): string {
  return `/listen/${encodeURIComponent(storyId)}?s=${signListen(storyId, key)}`;
}

/** Абсолютная ссылка для QR: origin запроса (или PROD_URL), без завершающего «/». */
export function listenUrl(origin: string, storyId: string, key?: string): string {
  return `${origin.replace(/\/+$/, "")}${listenPath(storyId, key)}`;
}

/**
 * QR в SVG. Цвет модулей — currentColor, фон прозрачный: цвет задаётся классами токенов (text-ink, bg-paper).
 * Коррекция ошибок M + поле 2 модуля: надёжно сканируется с проектора и с экрана телефона.
 */
export async function qrSvg(text: string): Promise<string> {
  const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  return svg
    .replace(/fill="#ffffff"/gi, 'fill="none"')
    .replace(/stroke="#000000"/gi, 'stroke="currentColor"')
    .replace("<svg ", '<svg role="img" aria-label="QR-код: голос рассказчика" ');
}

/** Тот же QR для скачивания (на слайд): чёрный на белом, без currentColor — открывается в любом редакторе. */
export async function qrSvgFile(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 4, width: 1024 });
}
