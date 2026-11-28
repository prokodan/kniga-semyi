// RU + KR «до / после» (#304 #301 #306): снимки и разметка страниц семьи RU + KR по ссылке АКНЦ — /start, /f новой
// семьи, согласие, /f демо-семьи Ким. Без проверок поведения: только снимки (e2e-screens/rukr/, артефакт CI
// kiosk-screens) и разметка <main> в лог (строки «RUKR <имя> <base64>») — для сравнения прогонов до и после PR.
// Только проект iphone: одного набора хватает.
import { expect, test, type Page } from "@playwright/test";
import { DEMO_FAMILY } from "@/fixtures/demo/family";

const SIZE = { width: 390, height: 844 } as const;

async function snap(page: Page, name: string, token?: string) {
  await page.setViewportSize(SIZE);
  const path = `e2e-screens/rukr/${name}.jpg`;
  const jpg = await page.screenshot({ path, type: "jpeg", quality: 50, fullPage: true });
  let html = await page.locator("main").first().innerHTML();
  if (token) html = html.split(token).join("<TOKEN>");
  console.log(`RUKR-HTML ${name} ${Buffer.from(html).toString("base64")}`);
  console.log(`RUKR-JPG ${name} ${jpg.toString("base64")}`);
}

test("RU + KR: снимки до / после", async ({ page }) => {
  test.skip(test.info().project.name !== "iphone", "один набор снимков");
  await page.setViewportSize(SIZE);

  await page.goto("/start?pack=koryo");
  await expect(page.getByRole("button", { name: "Создать книгу" })).toBeVisible();
  await snap(page, "01-start-aknc");

  await page.getByLabel("Как назовём книгу?").fill("Книга семьи RUKR");
  await page.getByLabel("Имя, как зовут в семье").fill("Бабушка Мария");
  await page.getByLabel(/Имя по-корейски/).fill("김마리아");
  await page.getByRole("button", { name: "Создать книгу" }).click();
  await expect(page.getByRole("heading", { name: "Книга создана ✓" })).toBeVisible();
  const token = new URL(page.url()).pathname.split("/").pop()!;

  await page.goto(`/f/${token}`);
  await expect(page.getByRole("heading", { name: "Книга семьи RUKR" })).toBeVisible();
  await snap(page, "02-f-new", token);

  await page.goto(`/consent/${token}`);
  await expect(page.locator("blockquote")).toBeVisible();
  await snap(page, "03-consent", token);

  await page.goto(`/f/${DEMO_FAMILY.access_token}`);
  await expect(page.getByRole("heading", { name: DEMO_FAMILY.name })).toBeVisible();
  await snap(page, "04-f-demo", DEMO_FAMILY.access_token);
});
