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
  const kim = page.locator(`[data-family="${DEMO_FAMILY.id}"]`);
  await expect(kim).toContainText(DEMO_FAMILY.name);
  await expect(kim).toContainText(`главы: ${DEMO_STORY_SEEDS.length} готово`);
  await expect(kim).toContainText("Цена книги:");
  await expect(kim.getByRole("link", { name: "Словарь имён" })).toHaveAttribute("href", /^\/f\/[^/]+\/names$/);
  await expect(page.locator(`[data-family="${DEMO_KIOSK_FAMILY.id}"]`)).toContainText("киоск АКНЦ");
  await page.getByRole("link", { name: "Киоск АКНЦ" }).click();
  await expect(kim).toHaveCount(0);
});

test("флаги #223: demo_flag в /api/health, список флагов и включение семье (labs)", async ({ page, request }) => {
  // e2e — не Production и без FLAGS_ON: окружением включены все флаги
  const health = await (await request.get("/api/health")).json();
  expect(health.flags_on).toContain("demo_flag");

  await adminLogin(page, "/admin");
  await page.goto("/admin/families");
  await expect(page.locator('[data-flag="demo_flag"]')).toContainText("включён окружением");
  const kim = page.locator(`[data-family="${DEMO_FAMILY.id}"]`);
  await kim.getByRole("button", { name: "demo_flag — включить семье" }).click();
  await expect(page.getByText(`demo_flag: включён семье ${DEMO_FAMILY.id.slice(0, 8)}`)).toBeVisible();
  await expect(kim).toContainText("labs: demo_flag");
  await expect(page.locator('[data-flag="demo_flag"]')).toContainText("семей с флагом: 1");
  // вернуть как было
  await kim.getByRole("button", { name: "✓ demo_flag — выключить семье" }).click();
  await expect(page.getByText(`demo_flag: выключен семье ${DEMO_FAMILY.id.slice(0, 8)}`)).toBeVisible();
  await expect(kim).not.toContainText("labs:");
});

test("носители #232: ссылка в /admin/reviews → правка и оценка с телефона → отозвать", async ({ page }) => {
  await adminLogin(page, "/admin");
  await page.getByRole("link", { name: "Носители: ссылки на проверку перевода →" }).click();
  await page.waitForURL(/\/admin\/reviews/);
  await expect(page.getByRole("heading", { name: "Носители языка" })).toBeVisible();
  await page.getByLabel("Проверяющий — только инициалы").fill("Тест Евал");
  await page.getByRole("button", { name: "Создать ссылку" }).click();
  const created = page.getByTestId("review-new-link");
  await expect(created).toContainText("Ссылка для Т. Е. (ru-ko");
  const href = await created.getByRole("link").getAttribute("href");
  expect(href).toMatch(/\/review\/[A-Za-z0-9_-]{32}$/);
  const reviewPath = new URL(href!).pathname;

  await page.goto(reviewPath);
  await expect(page.getByRole("heading", { name: /번역 검토/ })).toBeVisible();
  await page.getByRole("button", { name: "고치려면 누르세요: 1" }).click();
  await page.getByRole("textbox", { name: "고치기" }).fill("검토자가 고친 문장입니다.");
  await page.getByRole("button", { name: /^저장/ }).click();
  const first = page.locator('[data-paragraph="0"]');
  await expect(first).toContainText("검토자가 고친 문장입니다.");
  await expect(first).toContainText("수정됨");
  await page.getByRole("button", { name: "의미 4" }).click();
  await expect(page.getByRole("button", { name: "의미 4" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("✓ 저장됨")).toBeVisible();

  // сохранено на сервере: после перезагрузки — то же
  await page.reload();
  // открывается первый непроверенный текст — первый уже проверен, возвращаемся к нему
  await expect(page.getByTestId("review-progress")).toContainText("1개 확인");
  await page.getByRole("button", { name: /이전/ }).click();
  await expect(page.locator('[data-paragraph="0"]')).toContainText("검토자가 고친 문장입니다.");
  await expect(page.getByRole("button", { name: "의미 4" })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/admin/reviews");
  const card = page.locator("[data-review-link]").filter({ hasText: "Т. Е." }).first();
  await expect(card).toContainText("Проверено 1 из");
  await expect(card).toContainText("правок абзацев 1");
  await expect(card).toContainText("смысл 4.0");
  await card.getByRole("button", { name: "Отозвать" }).click();
  await expect(card).toContainText("отозвана");

  await page.goto(reviewPath);
  await expect(page.getByTestId("review-closed")).toBeVisible();
});
