// Помощники e2e (I13): тестовые аудио, заглушка микрофона, вход по PIN.
import { expect, type Page } from "@playwright/test";
import { E2E_ENV } from "./env";

export { E2E_ENV };

/**
 * WAV (8 кГц, моно, 16 бит) с тихим тоном. Файл строим в памяти — бинарники в репозиторий не кладём.
 * Длительность важна: заглушка ИИ «слышит» в записи ≤ 3 с короткий ответ (→ уточнение), длиннее — полный рассказ.
 * Если браузер не прочитает длительность, сервер оценит её по размеру (≈ 8 КБ/с) — та же сторона порога.
 */
export function wav(seconds: number): Buffer {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // моно
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(1200 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  return buf;
}

export const audioFile = (name: string, seconds: number) => ({ name, mimeType: "audio/wav", buffer: wav(seconds) });

/**
 * Заглушка микрофона для киоска (там нет «загрузить файл»): getUserMedia → фейковый поток,
 * MediaRecorder → по «Готово» отдаёт WAV. Настоящую запись через MediaRecorder проверяем руками на устройстве.
 */
export async function fakeMicrophone(page: Page) {
  await page.addInitScript((b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    class FakeTrack {
      kind = "audio";
      enabled = true;
      readyState = "live";
      onended: (() => void) | null = null;
      onmute: (() => void) | null = null;
      stop() {
        this.readyState = "ended";
      }
    }
    class FakeStream {
      private tracks = [new FakeTrack()];
      getTracks() {
        return this.tracks;
      }
      getAudioTracks() {
        return this.tracks;
      }
    }
    class FakeRecorder {
      static isTypeSupported(m: string) {
        return /^audio\/(mp4|webm)/.test(m);
      }
      state: "inactive" | "recording" | "paused" = "inactive";
      mimeType: string;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_stream: unknown, opts?: { mimeType?: string }) {
        this.mimeType = opts?.mimeType ?? "audio/mp4";
      }
      start() {
        this.state = "recording";
      }
      pause() {
        this.state = "paused";
      }
      resume() {
        this.state = "recording";
      }
      requestData() {}
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        const data = new Blob([bytes], { type: this.mimeType.split(";")[0] });
        setTimeout(() => {
          this.ondataavailable?.({ data });
          this.onstop?.();
        }, 0);
      }
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => new FakeStream(), enumerateDevices: async () => [] },
    });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, writable: true, value: FakeRecorder });
  }, wav(1).toString("base64"));
}

/** «Записать» через заглушку: старт → подождать → «Готово». */
export async function recordWithMic(page: Page, startLabel: string, ms: number) {
  await page.getByRole("button", { name: startLabel }).click();
  await expect(page.getByRole("button", { name: "Готово" })).toBeVisible();
  await page.waitForTimeout(ms);
  await page.getByRole("button", { name: "Готово" }).click();
}

/** Вход в /center, /admin, /admin/ai по ADMIN_PIN (если ещё не вошли). */
export async function adminLogin(page: Page, path: string) {
  await page.goto(path);
  const pin = page.getByLabel("PIN администратора");
  if (await pin.isVisible().catch(() => false)) {
    await pin.fill(E2E_ENV.ADMIN_PIN);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(pin).toBeHidden();
  }
}

/** Страница меняется на сервере (конвейер, перевод) — перезагружаем, пока не появится нужное. */
export async function reloadUntil(page: Page, check: () => Promise<void>, timeout = 60_000) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout, intervals: [1000, 2000, 3000] });
}
