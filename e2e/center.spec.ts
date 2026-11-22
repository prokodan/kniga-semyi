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
});
