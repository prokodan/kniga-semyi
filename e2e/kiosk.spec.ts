// Киоск АКНЦ (I13) на планшете: PIN → новый старейшина → голосовое согласие + архив → запись → очередь дня.
// На киоске нет «загрузить файл», поэтому микрофон — заглушка MediaRecorder (см. fakeMicrophone).
import { expect, test } from "@playwright/test";
import { E2E_ENV, fakeMicrophone, recordWithMic } from "./support";

test("киоск: PIN → старейшина → согласие → запись → очередь", async ({ page }) => {
  const elder = `Пак Анна E2E ${Date.now().toString(36)}`;
  await fakeMicrophone(page);

  await test.step("вход волонтёра по PIN", async () => {
    await page.goto("/kiosk");
    await page.getByLabel("PIN волонтёра").fill(E2E_ENV.KIOSK_PIN);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByRole("heading", { name: "Очередь дня" })).toBeVisible();
  });

  await test.step("карточка старейшины", async () => {
    await page.getByRole("link", { name: "+ Новый старейшина" }).click();
    await expect(page.getByRole("heading", { name: "Новый старейшина" })).toBeVisible();
    await page.getByLabel("Как зовут старейшину").fill(elder);
    await page.getByLabel("Год рождения").fill("1938");
    await page.getByLabel("Где родились").fill("Ташкент");
    const newVolunteer = page.getByRole("button", { name: "+ Я новый волонтёр" });
    if (await newVolunteer.isVisible()) await newVolunteer.click();
    await page.getByPlaceholder("Ваше имя").fill("Волонтёр E2E");
    await page.getByRole("button", { name: "Дальше — согласие и запись" }).click();
    await page.waitForURL(/\/kiosk\/session\//);
  });

  await test.step("голосовое согласие и галочка архива АКНЦ", async () => {
    await expect(page.getByRole("heading", { name: "Согласие на запись" })).toBeVisible();
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await recordWithMic(page, "Записать согласие", 800);
    await page.getByRole("button", { name: "Сохранить согласие" }).click();
    await expect(page.getByText(/Записано рассказов сегодня: 0/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("запись рассказа", async () => {
    await expect(page.getByRole("button", { name: "Начать запись" })).toBeVisible({ timeout: 30_000 });
    await recordWithMic(page, "Начать запись", 1200);
    await page.getByRole("button", { name: "Сохранить рассказ" }).click();
    await expect(page.getByText(/Записано рассказов сегодня: 1/)).toBeVisible({ timeout: 30_000 });
    // Короткий ответ → агент киоска просит уточнить (та же логика, что у семьи)
    await expect(page.getByText(/· уточнение/)).toBeVisible({ timeout: 60_000 });
  });

  await test.step("завершить → очередь дня", async () => {
    await page.getByRole("button", { name: "Завершить" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`Спасибо, ${elder}`) })).toBeVisible();
    await page.getByRole("link", { name: "Очередь дня" }).click();
    const row = page.getByRole("listitem").filter({ hasText: elder });
    await expect(row).toContainText("✓ согласие");
    await expect(row).toContainText("✓ в архив АКНЦ");
    await expect(row).toContainText("рассказов: 1");
    await expect(row).toContainText("волонтёр: Волонтёр E2E");
  });
});
