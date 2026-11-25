// #200: киоск на телефоне и планшете — скриншоты всех шагов (для PR) и проверка «без горизонтальной прокрутки».
// Три экрана: iPhone 15 Pro Max 430×932, iPhone 390×844, iPad 820×1180 (портрет). Снимки — e2e-screens/<экран>/*.jpg
// (CI выкладывает их артефактом kiosk-screens). Горизонтальная прокрутка, кнопка за краем экрана или ниже 48 px
// на любом шаге = тест красный. Плюс «Архив» и «▶ Показ»: без ссылок с токеном семьи и без голоса.
import { expect, test, type Page } from "@playwright/test";
import { DEMO_KIOSK_FAMILY } from "@/fixtures/demo/family";
import { E2E_ENV, fakeMicrophone, recordWithMic } from "./support";

const SCREENS = [
  { name: "430x932", width: 430, height: 932, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "820x1180", width: 820, height: 1180, mobile: false },
] as const;

for (const vp of SCREENS) {
  test.describe(`киоск ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: true, deviceScaleFactor: 1 });

    let n = 0;
    async function shot(page: Page, name: string) {
      await page.waitForLoadState("networkidle").catch(() => undefined);
      n += 1;
      await page.screenshot({ path: `e2e-screens/${vp.name}/${String(n).padStart(2, "0")}-${name}.jpg`, type: "jpeg", quality: 55, fullPage: true });
      const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
      expect.soft(scroll, `${vp.name} · ${name}: горизонтальная прокрутка (${scroll} > ${width})`).toBeLessThanOrEqual(width);
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .map((b) => ({ t: (b.textContent ?? "").trim().slice(0, 30), r: b.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0 && (r.right > window.innerWidth + 1 || r.left < -1 || r.height < 47.5))
          .map(({ t, r }) => `«${t}» ${Math.round(r.left)}…${Math.round(r.right)} × ${Math.round(r.height)} px`),
      );
      expect.soft(bad, `${vp.name} · ${name}: кнопки за краем экрана или ниже 48 px`).toEqual([]);
    }

    async function login(page: Page) {
      await page.goto("/kiosk");
      await page.getByLabel("PIN волонтёра").fill(E2E_ENV.KIOSK_PIN);
      await page.getByRole("button", { name: "Войти" }).click();
      await expect(page.getByRole("heading", { name: "Очередь дня" })).toBeVisible();
    }

    test("шаги киоска", async ({ page }) => {
      n = 0;
      const elder = `Тен Вера ${vp.name} ${Date.now().toString(36)}`;
      await fakeMicrophone(page);

      await page.goto("/kiosk");
      await shot(page, "pin");
      await login(page);
      await shot(page, "queue");

      await page.getByRole("link", { name: "+ Новый старейшина" }).click();
      await expect(page.getByRole("heading", { name: "Новый старейшина" })).toBeVisible();
      await page.getByLabel("Как зовут старейшину").fill(elder);
      await page.getByLabel("Год рождения").fill("1940");
      await page.getByLabel("Где родились").fill("Уштобе");
      const newVolunteer = page.getByRole("button", { name: "+ Я новый волонтёр" });
      if (await newVolunteer.isVisible()) await newVolunteer.click();
      await page.getByPlaceholder("Ваше имя").fill("Волонтёр экрана");
      await shot(page, "new-elder");
      await page.getByRole("button", { name: "Дальше — согласие и запись" }).click();
      await page.waitForURL(/\/kiosk\/session\//);

      await expect(page.getByRole("heading", { name: "Согласие на запись" })).toBeVisible();
      await page.getByRole("checkbox").check();
      await shot(page, "consent");
      await recordWithMic(page, "Записать согласие", 600);
      await shot(page, "consent-recorded");
      await page.getByRole("button", { name: "Сохранить согласие" }).click();

      await expect(page.getByRole("button", { name: "Начать запись" })).toBeVisible({ timeout: 30_000 });
      await shot(page, "question");
      await recordWithMic(page, "Начать запись", 1200);
      await shot(page, "story-recorded");
      await page.getByRole("button", { name: "Сохранить рассказ" }).click();
      await expect(page.getByText(/Записано рассказов сегодня: 1/)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Начать запись" })).toBeVisible({ timeout: 60_000 });
      await shot(page, "followup");

      await page.getByRole("button", { name: "Завершить" }).click();
      await expect(page.getByRole("heading", { name: new RegExp(`Спасибо, ${elder}`) })).toBeVisible();
      await shot(page, "finished");

      await page.getByRole("link", { name: "Очередь дня" }).click();
      await expect(page.getByRole("listitem").filter({ hasText: elder })).toBeVisible();
      await shot(page, "queue-row");
    });

    test("архив и ▶ Показ", async ({ page }) => {
      n = 20;
      await login(page);
      await page.getByRole("link", { name: "Архив", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Архив", exact: true })).toBeVisible();
      await expect(page.getByText(/Ли Нина/).first()).toBeVisible();
      // публичный экран: ни токена семьи, ни ссылок на книгу / черновик / главу с токеном, ни голоса
      const leaks = page.locator('a[href*="/f/"], a[href*="/book/"], a[href*="/draft"], a[href*="token="], a[href*="/listen/"], audio');
      await expect(leaks).toHaveCount(0);
      expect(await page.content()).not.toContain(DEMO_KIOSK_FAMILY.access_token);
      await shot(page, "archive");

      await page.getByRole("link", { name: "▶ Показ" }).click();
      await page.waitForURL(/\/kiosk\/archive\/show/);
      await expect(page.getByText(/^1 из \d+$/)).toBeVisible();
      await expect(leaks).toHaveCount(0);
      const html = await page.content();
      expect(html).not.toContain(DEMO_KIOSK_FAMILY.access_token);
      expect(html).not.toMatch(/access_token/);
      await shot(page, "show");
      const total = Number((await page.getByText(/^1 из \d+$/).textContent())?.split(" из ")[1] ?? 1);
      if (total > 1) {
        await page.getByRole("button", { name: "Следующая глава" }).click();
        await expect(page.getByText(new RegExp(`^2 из ${total}$`))).toBeVisible();
        await shot(page, "show-next");
      }
      await page.getByRole("link", { name: "✕ Выйти" }).click();
      await expect(page.getByRole("heading", { name: "Архив", exact: true })).toBeVisible();
    });
  });
}
