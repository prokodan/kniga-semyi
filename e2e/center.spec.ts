// Кабинет АКНЦ (I13): вход по ADMIN_PIN → счётчики → семьи → архив (только с archive_consent).
import { expect, test } from "@playwright/test";
import { DEMO_KIOSK_STORYTELLER } from "@/fixtures/demo/family";
import { adminLogin } from "./support";

test("кабинет АКНЦ: счётчики, семьи, архив", async ({ page }) => {
  await adminLogin(page, "/center");
  for (const tile of ["Минут голоса сохранено", "Старейшин записано", "Глав готово", "Из них через киоск"]) {
    await expect(page.getByText(tile, { exact: true })).toBeVisible();
  }
  await page.goto("/center/families?view=archive");
  await expect(page.getByText("Здесь только семьи, которые дали согласие на хранение записей в архиве АКНЦ.")).toBeVisible();
  await expect(page.getByText(DEMO_KIOSK_STORYTELLER.name).first()).toBeVisible();
  await expect(page.getByText(/Семей: [1-9]/)).toBeVisible();
  // У семьи с согласием на архив — кнопка «Открыть книгу»
  await expect(page.getByRole("link", { name: "Открыть книгу" }).first()).toHaveAttribute("href", /^\/book\//);
});

test("витрина «Архив АКНЦ»: книга, главы, голос; режим показа", async ({ page }) => {
  await adminLogin(page, "/center");
  await page.getByRole("link", { name: "Архив АКНЦ" }).click();
  await page.waitForURL(/\/center\/archive/);
  await expect(page.getByRole("heading", { level: 2, name: DEMO_KIOSK_STORYTELLER.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Открыть книгу" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Глава RU · KR" }).first()).toHaveAttribute("href", /^\/chapter\/.+\?token=/);

  await page.getByRole("link", { name: "▶ Режим показа" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Голоса старейшин/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Сводка" })).toHaveCount(0);
  await page.getByRole("link", { name: "✕ Выйти из показа" }).click();
  await expect(page.getByRole("link", { name: "Сводка" })).toBeVisible();
});
