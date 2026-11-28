// #354 (v2 Q3): ссылка проверяющему → правка абзаца → «Готово» → разбор (mock quality_analyze) → вкладка «Находки»:
// находка компонента «Промпт перевода» с примером «было → правка носителя», кнопка «Предложить правку».
// В CI нет GITHUB_TOKEN — кнопка честно подсказывает запустить Actions → quality-propose вручную. Флаги в CI включены все.
import { expect, test, type Page } from "@playwright/test";
import { adminLogin } from "./support";

async function ready(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function createTextLink(page: Page, reviewer: string): Promise<string> {
  await adminLogin(page, "/admin/quality/checks");
  await page.goto("/admin/quality/checks");
  await expect(page.getByRole("heading", { name: "Новая ссылка" })).toBeVisible();
  await ready(page);
  await page.locator('input[name=pair][value="ru-kk"]').check();
  await page.getByLabel(/Имя/).fill(reviewer);
  await page.locator('input[name=kind][value="text"]').check();
  const boxes = page.locator("[data-material] input[type=checkbox]:not([disabled])");
  await expect(boxes.first()).toBeVisible();
  await boxes.first().check();
  await page.getByRole("button", { name: /Создать ссылку/ }).click();
  const url = (await page.getByTestId("check-url").textContent())?.trim() ?? "";
  expect(url).toMatch(/\/review\/[A-Za-z0-9_-]{32}$/);
  return new URL(url).pathname;
}

test("Находки: правка носителя → разбор → находка по промпту → «Предложить правку»", async ({ page }, info) => {
  const tag = `түзету-${info.project.name}-${Date.now() % 100000}`;
  const path = await createTextLink(page, info.project.name === "pixel" ? "Сәуле Ж" : "Ерлан Б");

  await page.goto(path);
  await ready(page);
  await page.getByTestId("review2-start").click();
  await page.getByTestId("para-edit-0").click();
  const ta = page.getByTestId("para-text");
  await ta.fill(`${await ta.inputValue()} ${tag}`);
  await page.getByTestId("para-save").click();
  await expect(page.getByTestId("review2-status")).toContainText("✓");
  await page.getByTestId("review2-finish").click();
  await expect(page.getByTestId("review2-done")).toBeVisible();

  // разбор идёт сам после «Готово» (after()); «Разобрать сейчас» — на случай, если он ещё не дошёл
  await page.goto("/admin/quality/findings?pair=ru-kk");
  await expect(page.getByTestId("quality-findings")).toBeVisible();
  await ready(page);
  await page.getByTestId("digest-now").click();
  await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toBeVisible();

  const row = page.locator('[data-finding="prompt"]').filter({ hasText: tag });
  await expect
    .poll(
      async () => {
        if (await row.count()) return true;
        await page.goto("/admin/quality/findings?pair=ru-kk");
        return (await row.count()) > 0;
      },
      { timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);
  await expect(row.first().getByTestId("finding-example")).toContainText(tag);
  await expect(page.locator('[data-component="prompt"]').getByTestId("component-counters")).toContainText("новых");

  await page.getByTestId("propose-prompt").click();
  await expect(page.getByRole("alert").or(page.getByRole("status")).filter({ hasText: /quality-propose|строится/ }).first()).toBeVisible();
});
