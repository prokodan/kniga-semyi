// #274: страница главы для книги «Русский и казахский» (флаг lang_kk; в e2e FLAGS_ON не задан → все флаги включены).
// Новая семья выбирает RU + KZ → ответ → глава RU | KZ: казахский из story_texts (заглушка translate.kk.json), без
// корейского; буквы әіңғүұқө на экране и шрифт с ними. Демо-семья Ким (RU + KR) — разворот RU | KR как раньше.
// Снимки 390×844 и 430×932 — e2e-screens/chapter/ (артефакт CI). Имя *.family.spec.ts — проекты iphone и pixel.
import { expect, test, type Page } from "@playwright/test";
import editFixture from "@/fixtures/ai/edit.json";
import kkFixture from "@/fixtures/ai/translate.kk.json";
import translateFixture from "@/fixtures/ai/translate.json";
import { DEMO_FAMILY, DEMO_STORY_SEEDS } from "@/fixtures/demo/family";
import { audioFile, reloadUntil } from "./support";

const SIZES = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;
const KK_LETTERS = "әіңғүұқөһ";

async function shot(page: Page, name: string) {
  const p = test.info().project.name;
  const { width, height } = page.viewportSize()!;
  await page.screenshot({ path: `e2e-screens/chapter/${p}-${width}x${height}-${name}.jpg`, type: "jpeg", quality: 60, fullPage: true });
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect.soft(scroll, `${name} ${width}: горизонтальная прокрутка (${scroll} > ${width})`).toBeLessThanOrEqual(width);
}

test("книга RU + KZ: глава RU | KZ из story_texts, без корейского", async ({ page }) => {
  const familyName = `Книга семьи E2E KZ ${Date.now().toString(36)}`;

  await test.step("старт: казахская семья → книга RU + KZ (как culture.family.spec)", async () => {
    await page.goto("/start");
    await page.getByLabel("Как назовём книгу?").fill(familyName);
    await page.getByLabel("Имя, как зовут в семье").fill("Әжем Гүлнар");
    await page.getByRole("checkbox", { name: "Корё-сарам" }).uncheck();
    await page.getByRole("checkbox", { name: "Казахская" }).check();
    await expect(page.getByRole("radio", { name: /^Русский и казахский/ })).toBeChecked();
    await page.getByRole("button", { name: "Создать книгу" }).click();
    await expect(page.getByRole("heading", { name: "Книга создана ✓" })).toBeVisible();
  });
  const token = new URL(page.url()).pathname.split("/").pop()!;
  expect(token).toMatch(/^[0-9a-f]{64}$/);

  await test.step("согласие → ответ → уточнение (как в family.spec)", async () => {
    await page.getByRole("link", { name: "Начать: согласие на запись" }).click();
    await page.locator('input[type="file"]').setInputFiles(audioFile("soglasie.wav", 4));
    await page.getByRole("button", { name: "Сохранить согласие" }).click();
    await expect(page.getByText("Согласие записано ✓ Спасибо!")).toBeVisible();
    await page.getByRole("link", { name: "Записать первый рассказ" }).click();
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible({ timeout: 30_000 });
    const question = (await h1.textContent())!.trim();
    await page.locator('input[type="file"]').setInputFiles(audioFile("otvet.wav", 1));
    await page.getByRole("button", { name: "Отправить рассказ" }).click();
    await expect(page.getByText("Спасибо! Рассказ сохранён.")).toBeVisible();
    await expect(h1).not.toHaveText(question, { timeout: 60_000 });
    if (await page.getByText(/· уточнение/).isVisible()) {
      const followup = (await h1.textContent())!.trim();
      await page.locator('input[type="file"]').setInputFiles(audioFile("utochnenie.wav", 8));
      await page.getByRole("button", { name: "Отправить рассказ" }).click();
      await expect(page.getByText("Спасибо! Дополнение сохранено.")).toBeVisible();
      // интервью перешло к следующему вопросу — только тогда глава собирается (пока сессия на вопросе — ждёт уточнений)
      await expect(h1).not.toHaveText(followup, { timeout: 60_000 });
      await expect(page.getByText(/· уточнение/)).toBeHidden();
    }
  });

  await test.step("глава RU | KZ", async () => {
    await page.goto(`/f/${token}`);
    const chapter = page.getByRole("link", { name: /^1\. / });
    const storyId = (await chapter.getAttribute("href"))!.match(/\/chapter\/([0-9a-f-]{36})/)![1];
    await reloadUntil(
      page,
      async () => {
        const view = await (await page.request.get(`/api/stories/${storyId}?token=${token}`)).json();
        console.log("[chapter-kk] история:", JSON.stringify({ status: view.status, next: view.next, waiting: view.waiting, error: view.error, message: view.message }));
        await expect(chapter).toContainText("читать →", { timeout: 2000 });
      },
      90_000,
    );
    await chapter.click();
    await expect(page.getByRole("heading", { name: editFixture.title })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Қазақша" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "한국어" })).toHaveCount(0);
    await expect(page.getByText(translateFixture.title_ko)).toHaveCount(0);
    await expect(page.locator('article[lang="ko"]')).toHaveCount(0);
    await expect(page.getByText("우리 이야기")).toHaveCount(0); // подпись книги RU + KR — только у корейской книги

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.getByRole("tab", { name: "Русский" }).click();
      await expect(page.getByTestId("chapter-page-kk")).toBeHidden();
      await shot(page, "kz-01-ru");

      await page.getByRole("tab", { name: "Қазақша" }).click();
      const kk = page.getByTestId("chapter-page-kk");
      await expect(kk).toBeVisible();
      await expect(kk).toHaveAttribute("lang", "kk");
      await expect(kk.getByRole("heading", { name: kkFixture.title })).toBeVisible();
      await expect(kk.getByText(kkFixture.quote).first()).toBeVisible();
      const shown = (await kk.innerText()).toLowerCase();
      for (const ch of "әіңғүұқө") expect.soft(shown, `буква ${ch} на казахской странице`).toContain(ch);
      // Шрифт главы (Noto Serif) покрывает все казахские буквы, включая һ (её нет в заглушке): без «квадратиков»
      const faces = await page.evaluate(async (s) => (await document.fonts.load('16px "Noto Serif"', s)).length, KK_LETTERS);
      expect(faces, "Noto Serif с казахскими буквами").toBeGreaterThan(0);
      expect(await page.evaluate((s) => document.fonts.check('16px "Noto Serif"', s), KK_LETTERS)).toBe(true);
      await shot(page, "kz-02-kk");
    }
  });
});

test("демо RU + KR: разворот RU | KR как раньше", async ({ page }) => {
  const story = DEMO_STORY_SEEDS.at(0)!;
  await page.goto(`/chapter/${story.id}?token=${DEMO_FAMILY.access_token}`);
  await expect(page.getByRole("tab", { name: "한국어" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Қазақша" })).toHaveCount(0);
  await expect(page.getByText("우리 이야기")).toBeAttached();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.getByRole("tab", { name: "Русский" }).click();
    await shot(page, "kr-01-ru");
    await page.getByRole("tab", { name: "한국어" }).click();
    await expect(page.locator('article[lang="ko"]')).toBeVisible();
    await shot(page, "kr-02-ko");
  }
});
