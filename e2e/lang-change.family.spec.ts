// #301 #304 #306 (флаги culture_packs, lang_kk, lang_change — в e2e включены все): точка входа /start, страница семьи
// без корейского у книги без корейского, смена языков с галочкой, блокировка после первой главы и «Добавить язык»
// через демо-оплату. Снимки 390×844 — e2e-screens/lang-change/ (артефакт CI kiosk-screens): RU + KR до / после.
// Имя *.family.spec.ts — проекты iphone и pixel.
import { expect, test, type Page } from "@playwright/test";
import kkFixture from "@/fixtures/ai/translate.kk.json";
import { DEMO_FAMILY } from "@/fixtures/demo/family";
import { audioFile, reloadUntil } from "./support";

const SIZE = { width: 390, height: 844 } as const;
const WARNING = "После бесплатной главы сменить язык книги нельзя — можно только докупить ещё один язык.";

async function shot(page: Page, name: string) {
  await page.setViewportSize(SIZE);
  await page.screenshot({ path: `e2e-screens/lang-change/${test.info().project.name}-${name}.jpg`, type: "jpeg", quality: 60, fullPage: true });
}

async function createFamily(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByLabel("Как назовём книгу?").fill(name);
  await page.getByLabel("Имя, как зовут в семье").fill("Бабушка Мария");
  await page.getByRole("button", { name: "Создать книгу" }).click();
  await expect(page.getByRole("heading", { name: "Книга создана ✓" })).toBeVisible();
  const token = new URL(page.url()).pathname.split("/").pop()!;
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  return token;
}

test("RU + KR по ссылке АКНЦ: как было — снимки /start, /f, согласие", async ({ page }) => {
  await page.setViewportSize(SIZE);
  await page.goto("/start?pack=koryo");
  await expect(page.getByText("Книга семьи · 우리 이야기")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Корё-сарам" })).toBeChecked();
  await expect(page.getByRole("radio", { name: /корё мар/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /^Русский и корейский/ })).toBeChecked();
  await shot(page, "kr-01-start");

  const token = await createFamily(page, "/start?pack=koryo", `Книга семьи E2E kr ${Date.now().toString(36)}`);
  await page.goto(`/f/${token}`);
  await expect(page.getByText("Книга семьи · 우리 이야기")).toBeVisible();
  await expect(page.getByText(WARNING)).toBeVisible(); // #306: заранее, до первой главы
  await shot(page, "kr-02-f-new");

  await page.getByRole("link", { name: "Начать: согласие на запись" }).click();
  await expect(page.locator("blockquote")).toContainText("помогают с переводом на корейский.");
  await shot(page, "kr-03-consent");

  await page.goto(`/f/${DEMO_FAMILY.access_token}`);
  await expect(page.getByText("Книга семьи · 우리 이야기")).toBeVisible();
  await expect(page.locator('h3 [lang="ko"]').first()).toBeVisible(); // подписи разделов по-корейски
  await shot(page, "kr-04-f-demo");
});

test("общая ссылка /start: ничего не отмечено → книга RU, страница семьи без корейского", async ({ page }) => {
  await page.setViewportSize(SIZE);
  await page.goto("/start");
  for (const box of await page.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await expect(page.getByRole("radio", { name: /^Только русский/ })).toBeChecked();
  await expect(page.getByText(WARNING)).toBeVisible();
  await shot(page, "ru-01-start");
  const token = await createFamily(page, "/start", `Книга семьи E2E ru ${Date.now().toString(36)}`);

  await page.goto(`/f/${token}`);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/[가-힣]/);
  await expect(page.locator('[lang="ko"]')).toHaveCount(0);
  await expect(page.getByText("Книга семьи", { exact: true }).first()).toBeVisible();

  // смена языков до первой главы: экран согласия, без галочки — нельзя
  await page.getByRole("radio", { name: /^Русский и казахский/ }).click();
  await page.waitForURL(/\/consent\/[0-9a-f]{64}\/langs\?to=ru%2Ckk/);
  await expect(page.locator("blockquote")).toContainText("помогают с переводом на казахский.");
  await expect(page.getByText(WARNING)).toBeVisible();
  const save = page.getByRole("button", { name: "Сменить языки книги" });
  await expect(save).toBeDisabled();
  await shot(page, "ru-02-lang-consent");
  await page.getByRole("checkbox", { name: "Согласен" }).check();
  await save.click();
  await page.waitForURL(new RegExp(`/f/${token}$`));
  await expect(page.getByRole("radio", { name: /^✓ Русский и казахский/ })).toBeVisible();

  // без галочки сервер не меняет
  const res = await page.request.patch(`/api/families/${token}/langs`, { data: { langs: "ru" } });
  expect(res.status()).toBe(400);
});

test("RU + KR: первая глава → смена закрыта → «Добавить казахский» → демо-оплата → казахский перевод", async ({ page }) => {
  await page.setViewportSize(SIZE);
  const token = await createFamily(page, "/start?pack=koryo", `Книга семьи E2E add ${Date.now().toString(36)}`);

  await test.step("согласие и рассказ", async () => {
    await page.getByRole("link", { name: "Начать: согласие на запись" }).click();
    await page.locator('input[type="file"]').setInputFiles(audioFile("soglasie.wav", 4));
    await page.getByRole("button", { name: "Сохранить согласие" }).click();
    await expect(page.getByText("Согласие записано ✓ Спасибо!")).toBeVisible();
    await page.getByRole("link", { name: "Записать первый рассказ" }).click();
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible({ timeout: 30_000 });
    const question = (await h1.textContent())!.trim();
    await page.locator('input[type="file"]').setInputFiles(audioFile("otvet.wav", 1));
    await page.getByRole("button", { name: "Отправить рассказ" }).click();
    await expect(page.getByText("Спасибо! Рассказ сохранён.")).toBeVisible();
    await expect(h1).not.toHaveText(question, { timeout: 60_000 });
    if (await page.getByText(/· уточнение/).isVisible()) {
      const followup = (await h1.textContent())!.trim();
      await page.locator('input[type="file"]').setInputFiles(audioFile("utochnenie.wav", 8));
      await page.getByRole("button", { name: "Отправить рассказ" }).click();
      await expect(page.getByText("Спасибо! Дополнение сохранено.")).toBeVisible();
      await expect(h1).not.toHaveText(followup, { timeout: 60_000 });
    }
  });

  let storyId = "";
  await test.step("первая глава готова → языки закрыты", async () => {
    await page.goto(`/f/${token}`);
    const chapter = page.getByRole("link", { name: /^1\. / });
    storyId = (await chapter.getAttribute("href"))!.match(/\/chapter\/([0-9a-f-]{36})/)![1]!;
    await reloadUntil(page, async () => expect(chapter).toContainText("читать →", { timeout: 2000 }), 90_000);
    await expect(page.getByText("Первая глава готова — языки книги уже не меняются.", { exact: false })).toBeVisible();
    await expect(page.locator('a[href*="/consent/"][href*="/langs"]')).toHaveCount(0);
    await shot(page, "add-01-f-locked");
    const res = await page.request.patch(`/api/families/${token}/langs`, { data: { langs: "ru,kk", agree: true } });
    expect(res.status()).toBe(409);
  });

  await test.step("«Добавить казахский» → согласие галочкой → демо-оплата", async () => {
    await page.getByRole("link", { name: /^Добавить казахский/ }).click();
    await page.waitForURL(/\/checkout\/[0-9a-f]{64}\/lang\?add=kk/);
    await expect(page.locator("blockquote")).toContainText("помогают с переводом на корейский и казахский.");
    const pay = page.getByRole("button", { name: /^Оплатить .*\(демо\)$/ });
    await expect(pay).toBeDisabled();
    await shot(page, "add-02-checkout");
    await page.getByRole("checkbox", { name: "Согласен" }).check();
    await pay.click();
    await expect(page.getByText("Оплачено (демо) ✓")).toBeVisible();
    await expect(page.getByText("Язык добавлен: казахский")).toBeVisible();
    await shot(page, "add-03-paid");
  });

  await test.step("глава: RU | KR как было + казахский перевод ниже", async () => {
    await page.goto(`/chapter/${storyId}?token=${token}`);
    await reloadUntil(page, async () => expect(page.getByTestId("chapter-extra-kk")).toBeVisible({ timeout: 2000 }), 90_000);
    await expect(page.getByTestId("chapter-extra-kk")).toContainText(kkFixture.title);
    await expect(page.getByRole("tab", { name: "한국어" })).toBeVisible();
    await shot(page, "add-04-chapter");
    await page.goto(`/f/${token}`);
    await expect(page.getByText("Добавлено: казахский ✓")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Добавить казахский/ })).toHaveCount(0);
  });
});
