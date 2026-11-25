// Админка (I13): «Сбросить демо» пересоздаёт демо-семью; /admin/ai показывает расход в mock.
// Идёт последним проектом (admin): сброс меняет демо, на котором работают остальные тесты.
import { expect, test } from "@playwright/test";
import { DEMO_FAMILY, DEMO_KIOSK_FAMILY, DEMO_STORY_SEEDS } from "@/fixtures/demo/family";
import { adminLogin } from "./support";

test("пульт питча: «Сбросить демо»", async ({ page }) => {
  await adminLogin(page, "/admin");
  await expect(page.getByRole("heading", { name: "Пульт питча" })).toBeVisible();
  await page.getByRole("button", { name: "Сбросить демо" }).click();
  await expect(page.getByText(/Демо сброшено за [\d.]+ с: 7 глав, сказка, история киоска, книга \d+ стр\./)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(`Готовых глав: ${DEMO_STORY_SEEDS.length} из ${DEMO_STORY_SEEDS.length}`, { exact: false })).toBeVisible();
  await expect(page.getByText("История киоска: есть")).toBeVisible();
});

test("/admin/ai: расход и провайдеры в mock", async ({ page }) => {
  await adminLogin(page, "/admin/ai");
  await expect(page.getByRole("heading", { name: "ИИ: расход и провайдеры" })).toBeVisible();
  await expect(page.getByText("Не удалось прочитать таблицы ai_*")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Расход" }).first()).toBeVisible();
});

test("/admin/families: все семьи, главы, книга, цена, ссылки (#201)", async ({ page }) => {
  await adminLogin(page, "/admin");
  await page.getByRole("link", { name: "Семьи: главы, книги, цена →" }).click();
  await page.waitForURL(/\/admin\/families/);
  await expect(page.getByRole("heading", { name: "Семьи", exact: true })).toBeVisible();
  const kim = page.locator(`[data-family="${DEMO_FAMILY.id.slice(0, 8)}"]`);
  await expect(kim).toContainText(DEMO_FAMILY.name);
  await expect(kim).toContainText(`главы: ${DEMO_STORY_SEEDS.length} готово`);
  await expect(kim).toContainText("Цена книги:");
  await expect(kim.getByRole("link", { name: "Словарь имён" })).toHaveAttribute("href", /^\/f\/[^/]+\/names$/);
  await expect(page.locator(`[data-family="${DEMO_KIOSK_FAMILY.id.slice(0, 8)}"]`)).toContainText("киоск АКНЦ");
  await page.getByRole("link", { name: "Киоск АКНЦ" }).click();
  await expect(kim).toHaveCount(0);
});
