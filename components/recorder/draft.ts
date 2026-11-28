"use client";
// #65: черновик записи на телефоне (IndexedDB). Куски MediaRecorder (раз в секунду) сразу кладём сюда — закрыли
// вкладку, ушли со страницы, браузер выгрузил её в фоне — при следующем открытии записи предлагаем прослушать и
// отправить то, что успели (теряется не больше последней секунды). Отправили / «Записать заново» / пропустили
// вопрос — черновик удаляется. Только на этом устройстве, на сервер ничего не уходит. Киоск черновики не ведёт
// (общий планшет — чужая запись не должна всплыть у следующего старейшины).
// Нет IndexedDB (старый приватный режим Safari) или ошибка — молча работаем как раньше, запись это не ломает.

const DB = "ks-recorder";
const META = "meta";
const CHUNKS = "chunks";
const MAX_AGE_MS = 14 * 24 * 3600_000;

export type DraftMeta = Record<string, string | number | boolean | null>;

export interface Draft {
  key: string;
  mime: string;
  durationSec: number;
  updatedAt: number;
  meta: DraftMeta;
  blob: Blob;
}

interface MetaRow {
  key: string;
  mime: string;
  durationSec: number;
  updatedAt: number;
  meta: DraftMeta;
}

let dbp: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ["key", "seq"] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

const range = (key: string) => IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Все операции — по очереди: удаление старого черновика не должно обогнать запись первого куска нового.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(op: (db: IDBDatabase) => Promise<T>): Promise<T | null> {
  const next = queue.then(async () => {
    const db = await openDb();
    if (!db) return null;
    try {
      return await op(db);
    } catch (e) {
      console.warn("[recorder] черновик:", e instanceof Error ? e.message : e);
      return null;
    }
  });
  queue = next.catch(() => undefined);
  return next;
}

async function wipe(db: IDBDatabase, key: string) {
  const tx = db.transaction([META, CHUNKS], "readwrite");
  tx.objectStore(META).delete(key);
  tx.objectStore(CHUNKS).delete(range(key));
  await done(tx);
}

/** Удалить черновик (отправлен, «записать заново», вопрос пропущен). */
export function clearDraft(key: string): Promise<void> {
  return enqueue((db) => wipe(db, key)).then(() => undefined);
}

/** Черновик для этого ключа, если есть и не пустой; старше 14 дней — удаляется. */
export function loadDraft(key: string): Promise<Draft | null> {
  return enqueue(async (db) => {
    const tx = db.transaction([META, CHUNKS], "readonly");
    // оба запроса — сразу, в одной транзакции (старый Safari закрывает её между промисами)
    const metaReq = tx.objectStore(META).get(key);
    const rowsReq = tx.objectStore(CHUNKS).getAll(range(key));
    const meta = (await request(metaReq)) as MetaRow | undefined;
    const rows = ((await request(rowsReq)) ?? []) as { seq: number; data: ArrayBuffer }[];
    if (!meta || rows.length === 0 || Date.now() - meta.updatedAt > MAX_AGE_MS) {
      if (meta || rows.length) await wipe(db, key);
      return null;
    }
    rows.sort((a, b) => a.seq - b.seq);
    const blob = new Blob(
      rows.map((r) => r.data),
      { type: meta.mime },
    );
    if (blob.size === 0) {
      await wipe(db, key);
      return null;
    }
    return { key, mime: meta.mime, durationSec: meta.durationSec, updatedAt: meta.updatedAt, meta: meta.meta ?? {}, blob };
  });
}

/** Новый черновик для записи: старый с тем же ключом стирается, дальше — куски по мере прихода. */
export function startDraft(key: string, mime: string, meta: DraftMeta) {
  let seq = 0;
  const row: MetaRow = { key, mime, durationSec: 0, updatedAt: Date.now(), meta };
  void enqueue(async (db) => {
    await wipe(db, key);
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(row);
    await done(tx);
  });
  return {
    /** Кусок из ondataavailable; durationSec — сколько записано к этому моменту. */
    append(data: Blob, durationSec: number, type?: string) {
      if (!data || data.size === 0) return;
      const n = seq++;
      void enqueue(async (db) => {
        const buf = await data.arrayBuffer(); // ArrayBuffer, не Blob: старые Safari хранили Blob в IndexedDB с ошибками
        row.durationSec = Math.max(row.durationSec, Math.round(durationSec * 10) / 10);
        row.updatedAt = Date.now();
        if (type) row.mime = type;
        const tx = db.transaction([META, CHUNKS], "readwrite");
        tx.objectStore(CHUNKS).put({ key, seq: n, data: buf });
        tx.objectStore(META).put({ ...row });
        await done(tx);
      });
    },
    /** Запись остановлена: точная длительность и тип. */
    finish(durationSec: number, type?: string) {
      void enqueue(async (db) => {
        row.durationSec = Math.round(durationSec * 10) / 10;
        row.updatedAt = Date.now();
        if (type) row.mime = type;
        const tx = db.transaction(META, "readwrite");
        tx.objectStore(META).put({ ...row });
        await done(tx);
      });
    },
  };
}

export type DraftWriter = ReturnType<typeof startDraft>;
