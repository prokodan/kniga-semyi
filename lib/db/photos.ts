import "server-only";
// #269: фото людей древа. Кладёт только сервер (service-ключ), браузер в Supabase не ходит.
// Бакет photos: <family_id>/people/<entity_id>-<время>.jpg (новое имя при замене — старые подписанные ссылки
// и кэш браузера не показывают прежнее фото). Без Supabase — память процесса (data:-ссылки), для локального запуска.
import { BUCKETS, getDbOrNull } from "./index";

/** Сколько живёт ссылка на фото (страница древа открыта час — хватает) */
const TTL = 60 * 60;
/** После ужатия в браузере (512 × 512 JPEG) фото ≈ 40–120 КБ; больше — не от нашей формы */
export const PERSON_PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;

const g = globalThis as { __treePhotoMemory?: Map<string, string> };
const memory = () => (g.__treePhotoMemory ??= new Map());

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

/** JPEG или PNG по первым байтам (react-pdf печатает только их; HEIC браузер уже перевёл в JPEG). */
export function photoKind(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

/** Положить фото человека; вернуть путь для family_entities.photo_url. */
export async function savePersonPhoto(familyId: string, entityId: string, bytes: Uint8Array): Promise<string> {
  if (!bytes.length) throw new PhotoError("Фото пустое — выберите другое");
  if (bytes.length > PERSON_PHOTO_MAX_BYTES) throw new PhotoError("Фото слишком большое — выберите другое");
  const type = photoKind(bytes);
  if (!type) throw new PhotoError("Это не фотография JPEG или PNG — выберите другое фото");
  const path = `${familyId}/people/${entityId}-${Date.now().toString(36)}.${type === "image/png" ? "png" : "jpg"}`;
  const db = getDbOrNull();
  if (!db) {
    memory().set(path, `data:${type};base64,${Buffer.from(bytes).toString("base64")}`);
    return path;
  }
  const { error } = await db.storage.from(BUCKETS.photos).upload(path, bytes, { contentType: type, upsert: true });
  if (error) throw new Error(`фото человека: ${error.message}`);
  return path;
}

/** Убрать файл прежнего фото (ошибка не важна — строка в базе уже без него). Только фото людей древа. */
export async function removePersonPhoto(familyId: string, path: string | null): Promise<void> {
  if (!path || !path.startsWith(`${familyId}/people/`)) return;
  const db = getDbOrNull();
  if (!db) {
    memory().delete(path);
    return;
  }
  await db.storage.from(BUCKETS.photos).remove([path]).then(
    () => undefined,
    () => undefined,
  );
}

/** Подписанные ссылки на фото одним запросом: путь → ссылка (нет файла — пути нет в ответе). */
export async function photoUrls(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p && !/^https?:\/\//i.test(p)))];
  const out: Record<string, string> = {};
  for (const p of paths) if (p && /^https?:\/\//i.test(p)) out[p] = p;
  if (!list.length) return out;
  const db = getDbOrNull();
  if (!db) {
    for (const p of list) {
      const url = memory().get(p);
      if (url) out[p] = url;
    }
    return out;
  }
  const { data, error } = await db.storage.from(BUCKETS.photos).createSignedUrls(list, TTL);
  if (error || !data) return out;
  for (const r of data) if (r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  return out;
}
