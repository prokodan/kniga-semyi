// #65 #66 запись голоса: незаконченный кусок не теряется при закрытии вкладки (черновик в IndexedDB), «Пропустить» во
// время записи недоступно, с неотправленной записью — переспрашивает. Одинаково для RU + KR, RU + KZ и «Только русский».
// Имя *.family.spec.ts — проекты iphone (WebKit) и pixel (Chromium). Флаги в e2e включены все (FLAGS_ON не задан).
// Микрофон — заглушка: MediaRecorder отдаёт куски WAV раз в timeslice, как настоящий (start(1000)).
// Снимки 390×844 — e2e-screens/recorder/ (артефакт CI).
import { expect, test, type Page } from "@playwright/test";
import { audioFile, wav } from "./support";

const SIZE = { width: 390, height: 844 } as const;
const RESTORED = /Нашли запись, которую вы не успели отправить/;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-screens/recorder/${test.info().project.name}-${name}.jpg`, type: "jpeg", quality: 60, fullPage: true });
}

/** Микрофон-заглушка с кусками: start(timeslice) → ondataavailable раз в timeslice, requestData / stop — сразу. */
async function chunkedMicrophone(page: Page) {
  await page.addInitScript((b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const PARTS = 20;
    const size = Math.ceil(bytes.length / PARTS);
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
      private part = 0;
      private timer: ReturnType<typeof setInterval> | null = null;
      constructor(_stream: unknown, opts?: { mimeType?: string }) {
        this.mimeType = opts?.mimeType ?? "audio/mp4";
      }
      private emit(all = false) {
        const end = all ? PARTS : Math.min(PARTS, this.part + 1);
        if (end <= this.part) return;
        const data = new Blob([bytes.slice(this.part * size, end * size)], { type: this.mimeType.split(";")[0] });
        this.part = end;
        this.ondataavailable?.({ data });
      }
      start(timeslice?: number) {
        this.state = "recording";
        if (timeslice) this.timer = setInterval(() => this.state === "recording" && this.emit(), timeslice);
      }
      pause() {
        this.state = "paused";
      }
      resume() {
        this.state = "recording";
      }
      requestData() {
        this.emit();
      }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        if (this.timer) clearInterval(this.timer);
        setTimeout(() => {
          this.emit(true);
          this.onstop?.();
        }, 0);
      }
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => new FakeStream(), enumerateDevices: async () => [] },
    });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, writable: true, value: FakeRecorder });
  }, wav(10).toString("base64"));
}

const CASES = [
  { id: "kr", title: "RU + KR", choice: null },
  { id: "kz", title: "RU + KZ", choice: /^Русский и казахский/ },
  { id: "ru", title: "только RU", choice: /^Только русский/ },
] as const;

for (const c of CASES) {
  test(`запись (${c.title}): закрыли вкладку посреди записи → запись цела; «Пропустить» не сбрасывает запись`, async ({ page }) => {
    await page.setViewportSize(SIZE);
    await chunkedMicrophone(page);
    const familyName = `Книга семьи E2E rec ${c.id} ${Date.now().toString(36)}`;

    await test.step("старт и согласие", async () => {
      await page.goto("/start");
      await page.getByLabel("Как назовём книгу?").fill(familyName);
      await page.getByLabel("Имя, как зовут в семье").fill(c.id === "kz" ? "Әжем Гүлнар" : "Бабушка Мария");
      if (c.choice) {
        await page.getByRole("checkbox", { name: "Корё-сарам" }).uncheck();
        await page.getByRole("checkbox", { name: "Казахская" }).check();
        await page.getByRole("radio", { name: c.choice }).check();
      }
      await page.getByRole("button", { name: "Создать книгу" }).click();
      await expect(page.getByRole("heading", { name: "Книга создана ✓" })).toBeVisible();
      await page.getByRole("link", { name: "Начать: согласие на запись" }).click();
      await page.locator('input[type="file"]').setInputFiles(audioFile("soglasie.wav", 4));
      await page.getByRole("button", { name: "Сохранить согласие" }).click();
      await expect(page.getByText("Согласие записано ✓ Спасибо!")).toBeVisible();
      await page.getByRole("link", { name: "Записать первый рассказ" }).click();
    });

    const h1 = page.getByRole("heading", { level: 1 });
    const skip = page.getByRole("button", { name: "Пропустить" });
    const later = page.getByRole("button", { name: "Вернуться позже" });
    let question = "";

    await test.step("во время записи «Пропустить» и «Вернуться позже» недоступны", async () => {
      await expect(h1).toBeVisible({ timeout: 30_000 });
      question = (await h1.textContent())!.trim();
      await page.getByRole("button", { name: "Начать запись" }).click();
      await expect(page.getByRole("button", { name: "Готово" })).toBeVisible();
      await expect(skip).toBeDisabled();
      await expect(later).toBeDisabled();
      await expect(page.getByText("Идёт запись — чтобы перейти к другому вопросу, сначала нажмите «Готово».")).toBeVisible();
      await page.waitForTimeout(2600); // 2 куска по 1 с ушли в черновик
      await shot(page, `${c.id}-01-recording`);
    });

    await test.step("вкладку закрыли посреди записи → при возврате запись на месте, отправляется", async () => {
      await page.reload();
      await expect(h1).toHaveText(question, { timeout: 30_000 });
      await expect(page.getByText(RESTORED)).toBeVisible();
      await expect(page.locator("audio")).toHaveCount(1);
      await shot(page, `${c.id}-02-restored`);
      await page.getByRole("button", { name: "Отправить рассказ" }).click();
      await expect(page.getByText("Спасибо! Рассказ сохранён.")).toBeVisible();
      await expect(h1).not.toHaveText(question, { timeout: 60_000 });
    });

    await test.step("отправленная запись больше не всплывает", async () => {
      question = (await h1.textContent())!.trim();
      await page.reload();
      await expect(h1).toHaveText(question, { timeout: 30_000 });
      await page.waitForTimeout(1500);
      await expect(page.getByText(RESTORED)).toBeHidden();
    });

    await test.step("неотправленная запись: «Пропустить» переспрашивает, «Нет» — запись цела", async () => {
      await page.getByRole("button", { name: "Начать запись" }).click();
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "Готово" }).click();
      await expect(page.getByText(/Запись готова/)).toBeVisible();
      await expect(skip).toBeEnabled();
      await skip.click();
      const ask = page.getByRole("alertdialog", { name: "Запись не отправлена" });
      await expect(ask).toContainText("Пропустить вопрос и удалить её?");
      await shot(page, `${c.id}-03-confirm-skip`);
      await ask.getByRole("button", { name: "Нет, отправлю" }).click();
      await expect(page.getByText(/Запись готова/)).toBeVisible();
      await expect(h1).toHaveText(question);
    });

    await test.step("«Да, удалить» → следующий вопрос, черновик удалён", async () => {
      await skip.click();
      await page.getByRole("alertdialog", { name: "Запись не отправлена" }).getByRole("button", { name: "Да, удалить" }).click();
      await expect(h1).not.toHaveText(question, { timeout: 30_000 });
      const next = (await h1.textContent())!.trim();
      await page.reload();
      await expect(h1).toHaveText(next, { timeout: 30_000 });
      await page.waitForTimeout(1500);
      await expect(page.getByText(RESTORED)).toBeHidden();
      await expect(page.getByRole("button", { name: "Начать запись" })).toBeVisible();
    });
  });
}
