// #333 #340: RU + KR «до / после» для страницы главы и /listen (демо Ким, первая глава) — снимки
// (e2e-screens/rukr/, артефакт CI kiosk-screens) и разметка <main> в лог. Подписанные ссылки Storage
// (token=…) и токен семьи заменены метками — разметка двух прогонов сравнивается по хэшу «RUKR-SHA».
// Только проект iphone: одного набора хватает.
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_FAMILY, DEMO_STORY_SEEDS } from "@/fixtures/demo/family";

const SIZE = { width: 390, height: 844 } as const;

function normalize(html: string, token: string): string {
  return html
    .split(token)
    .join("<TOKEN>")
    .replace(/token=eyJ[\w.-]+/g, "token=<SIG>"); // подписанные ссылки Storage (фото, голос)
}

async function snap(page: Page, name: string, token: string) {
  await page.setViewportSize(SIZE);
  await page.evaluate(() => document.fonts.ready);
  const jpg = await page.screenshot({ path: `e2e-screens/rukr/${name}.jpg`, type: "jpeg", quality: 50, fullPage: true });
  const html = normalize(await page.locator("main").first().innerHTML(), token);
  const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 16);
  console.log(`RUKR-SHA ${name} html=${sha(html)} jpg=${sha(jpg)}`);
  console.log(`RUKR-HTML ${name} ${Buffer.from(html).toString("base64")}`);
  console.log(`RUKR-JPG ${name} ${jpg.toString("base64")}`);
}

test("RU + KR: глава и /listen — снимки до / после", async ({ page }) => {
  test.skip(test.info().project.name !== "iphone", "один набор снимков");
  const story = DEMO_STORY_SEEDS.at(0)!;
  const token = DEMO_FAMILY.access_token;

  await page.goto(`/chapter/${story.id}?token=${token}`);
  await expect(page.getByText("카메라를 대면 목소리를 들을 수 있어요")).toBeVisible();
  await snap(page, "05-chapter-demo", token);

  const href = (await page.getByRole("link", { name: "Открыть страницу голоса" }).getAttribute("href"))!;
  await page.goto(href);
  await expect(page.getByText("손주들을 위한 가족의 이야기")).toBeVisible();
  await snap(page, "06-listen-demo", token);
});
