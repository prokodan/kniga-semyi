// #233 (флаг culture_packs; в e2e включены все флаги): «Кто ваша семья?» на /start → казахская семья слышит общий
// костяк без корейской строки, книга RU + KZ предложена сама. Имя файла *.family.spec.ts — проекты iphone и pixel.
import { expect, test } from "@playwright/test";
import { GENERAL_QUESTIONS } from "@/content/packs/general/questions";
import { audioFile } from "./support";

test("казахская семья: выбор на старте → вопрос без корейской строки", async ({ page }) => {
  await test.step("старт: «Кто ваша семья?» — казахская вместо корё-сарам", async () => {
    await page.goto("/start");
    await page.getByLabel("Как назовём книгу?").fill(`Книга семьи KZ ${Date.now().toString(36)}`);
    await page.getByLabel("Имя, как зовут в семье").fill("Әжем Сауле");
    await expect(page.getByLabel(/Имя по-корейски/)).toBeVisible(); // по умолчанию — корё-сарам, как сейчас
    await page.getByRole("checkbox", { name: "Корё-сарам" }).uncheck();
    await page.getByRole("checkbox", { name: "Казахская" }).check();
    await expect(page.getByLabel(/Имя по-корейски/)).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /^Русский и казахский/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /корё мар/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Создать книгу" }).click();
    await expect(page.getByRole("heading", { name: "Книга создана ✓" })).toBeVisible();
  });

  await test.step("согласие и первый вопрос: общий костяк, без корейского", async () => {
    await page.getByRole("link", { name: "Начать: согласие на запись" }).click();
    await page.locator('input[type="file"]').setInputFiles(audioFile("soglasie.wav", 4));
    await page.getByRole("button", { name: "Сохранить согласие" }).click();
    await expect(page.getByText("Согласие записано ✓ Спасибо!")).toBeVisible();
    await page.getByRole("link", { name: "Записать первый рассказ" }).click();
    await expect(page.getByRole("heading", { level: 1, name: GENERAL_QUESTIONS[0]!.text.ru })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[lang="ko"]')).toHaveCount(0);
  });
});
