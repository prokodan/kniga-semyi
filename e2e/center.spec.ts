// Кабинет АКНЦ (I13): вход по ADMIN_PIN → счётчики → семьи → архив (только с archive_consent).
// #201: в кабинете только семьи киоска — семья /start (демо «Семья Ким») здесь не видна.
import { expect, test } from "@playwright/test";
import { DEMO_FAMILY, DEMO_KIOSK_FAMILY, DEMO_KIOSK_STORYTELLER } from "@/fixtures/demo/family";
import { adminLogin } from "./support";

test("кабинет АКНЦ: счётчики, семьи, архив", async ({ page }) => {
  await adminLogin(page, "/center");
  for (const tile of ["Минут голоса сохранено", "Старейшин записано", "Глав готово", "Семей через киоск"]) {
    await expect(page.getByText(tile, { exact: true })).toBeVisible();
  }
  await page.goto("/center/families?view=archive");
  await expect(page.getByText("Здесь только семьи, которые дали согласие на хранение записей в архиве АКНЦ.")).toBeVisible();
  await expect(page.getByText(DEMO_KIOSK_STORYTELLER.name).first()).toBeVisible();
  await expect(page.getByText(/Семей: [1-9]/)).toBeVisible();
  // У семьи с согласием на архив — кнопка «Открыть книгу»
  await expect(page.getByRole("link", { name: "Открыть книгу" }).first()).toHaveAttribute("href", /^\/book\//);

  await page.goto("/center/families");
  await expect(page.getByText(DEMO_KIOSK_FAMILY.name)).toBeVisible();
  await expect(page.getByText(DEMO_FAMILY.name)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Семьи сами" })).toHaveCount(0);
});

test("витрина «Архив АКНЦ»: книга, главы, голос; режима показа нет (он в киоске)", async ({ page }) => {
  await adminLogin(page, "/center");
  await page.getByRole("link", { name: "Архив АКНЦ" }).click();
  await page.waitForURL(/\/center\/archive/);
  await expect(page.getByRole("heading", { level: 2, name: DEMO_KIOSK_STORYTELLER.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Открыть книгу" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Глава RU · KR" }).first()).toHaveAttribute("href", /^\/chapter\/.+\?token=/);
  await expect(page.getByRole("link", { name: "▶ Режим показа" })).toHaveCount(0);
  // старая ссылка ?show=1 открывает обычную витрину кабинета
  await page.goto("/center/archive?show=1");
  await expect(page.getByRole("link", { name: "Сводка" })).toBeVisible();
});
