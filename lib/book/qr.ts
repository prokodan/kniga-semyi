// QR главы (I3): подпись публичной ссылки на голос и QR в SVG.
// /listen/<storyId>?s=<подпись> открывается без токена семьи и только для этой истории.
// Подпись — HMAC-SHA256(storyId), первые 16 байт в base64url (22 символа — QR остаётся крупным и читается со слайда).
// Секрет подписи (#67): LISTEN_SECRET, если задан, иначе прежний — выводится из SUPABASE_SERVICE_ROLE_KEY;
// без Supabase — локальный секрет (режим mock / тесты).
// Проверка принимает ОБА секрета: новый LISTEN_SECRET и прежний (из ключа базы). Так QR, напечатанные до появления
// LISTEN_SECRET (PDF книг, слайды, демо), открываются и после: ни одна старая ссылка не ломается. Новые QR / PDF
// подписываются новым секретом. Без LISTEN_SECRET всё как до #67. Прежний секрет живёт, пока не сменили service-ключ.
// Здесь нет server-only, чтобы функции тестировались напрямую; секрет читается только на сервере.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { env } from "@/lib/env";

const SIG_BYTES = 16;
const SIG_RE = /^[A-Za-z0-9_-]{22}$/;

/** Прежний секрет (до #67): из service-ключа базы, без Supabase — локальный. */
export function legacyListenSecret(service = env.supabaseServiceRoleKey()): string {
  if (service) return createHash("sha256").update(`kniga-semyi:listen:v1:${service}`).digest("hex");
  return "kniga-semyi-local-listen-secret";
}

/** Секрет для НОВЫХ подписей: LISTEN_SECRET, иначе прежний. */
function secret(): string {
  return env.listenSecret() ?? legacyListenSecret();
}

/** Секреты, которыми проверяем подпись: новый (если задан) и прежний — без повторов. */
function verifyKeys(): string[] {
  const explicit = env.listenSecret();
  const legacy = legacyListenSecret();
  return explicit && explicit !== legacy ? [explicit, legacy] : [legacy];
}

function mac(storyId: string, key: string): Buffer {
  return createHmac("sha256", key).update(`listen:${storyId}`).digest().subarray(0, SIG_BYTES);
}

/** Подпись ссылки на голос истории. */
export function signListen(storyId: string, key = secret()): string {
  return mac(storyId, key).toString("base64url");
}

/**
 * Проверка подписи (в постоянное время). Любая ошибка формата → false.
 * key — проверить одним секретом (тесты); без него — новым LISTEN_SECRET и прежним секретом (#67).
 */
export function verifyListen(storyId: string, sig: string | null | undefined, key?: string | string[]): boolean {
  if (!sig || !SIG_RE.test(sig) || !storyId) return false;
  const given = Buffer.from(sig, "base64url");
  const keys = key === undefined ? verifyKeys() : Array.isArray(key) ? key : [key];
  let okAny = false;
  for (const k of keys) {
    const expected = mac(storyId, k);
    // все ключи проверяем всегда — время ответа не зависит от того, какой подошёл
    if (given.length === expected.length && timingSafeEqual(given, expected)) okAny = true;
  }
  return okAny;
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
