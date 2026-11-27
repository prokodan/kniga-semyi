// #299 (+ #293 #294, часть #245): тексты интерфейса по языкам книги. Книга RU + KZ и «Только русский» — нигде нет
// корейского (согласие, книга, словарь имён, ожидание, глава, QR, /listen, черновик); RU + KR (демо Ким) — как было.
// Флаги в e2e включены все (FLAGS_ON не задан). Снимки 390×844 — e2e-screens/langs/ (артефакт CI).
// Имя *.family.spec.ts — проекты iphone и pixel.
import { expect, test, type Page } from "@playwright/test";
import editFixture from "@/fixtures/ai/edit.json";
import kkFixture from "@/fixtures/ai/translate.kk.json";
import { DEMO_FAMILY, DEMO_STORY_SEEDS } from "@/fixtures/demo/family";
import { audioFile, reloadUntil } from "./support";

const SIZE = { width: 390, height: 844 } as const;
const HANGUL = /[가-힣]/;

async function shot(page: Page, name: string) {
  await page.setViewportSize(SIZE);
  await page.screenshot({ path: `e2e-screens/langs/${test.info().project.name}-${name}.jpg`, type: "jpeg", quality: 60, fullPage: true });
}

/** На странице нет корейского: ни слова «корейский», ни хангыля, ни элементов lang="ko". */
async function noKorean(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  expect.soft(text, `${where}: «корейск…»`).not.toMatch(/корейск/i);
  expect.soft(text, `${where}: хангыль`).not.toMatch(HANGUL);
  await expect.soft(page.locator('[lang="ko"]'), `${where}: lang="ko"`).toHaveCount(0);
}

const CASES = [
  { id: "kz", choice: /^Русский и казахский/, langs: ["ru", "kk"], phrase: "казахский перевод" },
  { id: "ru", choice: /^Только русский/, langs: ["ru"], phrase: null },
] as const;

for (const c of CASES) {
  test(`книга ${c.id === "kz" ? "RU + KZ" : "только RU"}: без корейского в интерфейсе`, async ({ page }) => {
    await page.setViewportSize(SIZE);
    const familyName = `Книга семьи E2E langs ${c.id} ${Date.now().toString(36)}`;

    await test.step("старт: казахская семья, языки книги", async () => {
      await page.goto("/start");
      await page.getByLabel("Как назовём книгу?").fill(familyName);
      await page.getByLabel("Имя, как зовут в семье").fill("Әжем Гүлнар");
      await page.getByRole("checkbox", { name: "Корё-сарам" }).uncheck();
      await page.getByRole("checkbox", { name: "Казахская" }).check();
      await page.getByRole("radio", { name: c.choice }).check();
      await page.getByRole("button", { name: "Создать книгу" }).click();
      await expect(page.getByRole("heading", { name: "Книга создана ✓" })).toBeVisible();
    });
    const token = new URL(page.url()).pathname.split("/").pop()!;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    await test.step("согласие: про перевод — по языкам книги", async () => {
      await page.getByRole("link", { name: "Начать: согласие на запись" }).click();
      const consent = page.locator("blockquote");
      await expect(consent).toContainText("внешние сервисы искусственного интеллекта");
      if (c.phrase) await expect(consent).toContainText("помогают с переводом на казахский.");
      else await expect(consent).toContainText("они переводят речь в текст. Записи и книгу видит только наша семья.");
      await noKorean(page, "согласие");
      await shot(page, `${c.id}-01-consent`);
      await page.locator('input[type="file"]').setInputFiles(audioFile("soglasie.wav", 4));
      await page.getByRole("button", { name: "Сохранить согласие" }).click();
      await expect(page.getByText("Согласие записано ✓ Спасибо!")).toBeVisible();
    });

    await test.step("ответ → уточнение (как в chapter-kk.family.spec)", async () => {
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
        await expect(h1).not.toHaveText(followup, { timeout: 60_000 });
        await expect(page.getByText(/· уточнение/)).toBeHidden();
      }
    });

    let storyId = "";
    await test.step("глава готова; GET /api/stories — языки книги", async () => {
      await page.goto(`/f/${token}`);
      const chapter = page.getByRole("link", { name: /^1\. / });
      storyId = (await chapter.getAttribute("href"))!.match(/\/chapter\/([0-9a-f-]{36})/)![1]!;
      await reloadUntil(page, async () => expect(chapter).toContainText("читать →", { timeout: 2000 }), 90_000);
      const view = await (await page.request.get(`/api/stories/${storyId}?token=${token}`)).json();
      expect(view.done).toBe(true);
      expect(view.book_langs).toEqual(c.langs);
      if (c.id === "kz") expect(view.kk?.title).toBe(kkFixture.title);
      else expect(view.kk).toBeUndefined();
    });

    await test.step("страница главы: QR без корейской строки", async () => {
      await page.goto(`/chapter/${storyId}?token=${token}`);
      await expect(page.getByRole("heading", { name: editFixture.title })).toBeVisible();
      await expect(page.getByText("Наведите камеру — и услышите голос")).toBeVisible();
      await noKorean(page, "глава");
      await shot(page, `${c.id}-02-chapter`);
    });

    await test.step("страница голоса /listen: второй язык — по книге", async () => {
      const href = (await page.getByRole("link", { name: "Открыть страницу голоса" }).getAttribute("href"))!;
      await page.goto(href);
      await expect(page.getByText("Голос записан семьёй для книги внукам.")).toBeVisible();
      if (c.id === "kz") await expect(page.locator('[lang="kk"]').filter({ hasText: kkFixture.title })).toBeVisible();
      else await expect(page.locator('[lang="kk"]')).toHaveCount(0);
      await noKorean(page, "/listen");
      await shot(page, `${c.id}-03-listen`);
    });

    await test.step("черновик, словарь имён, книга — без корейского", async () => {
      await page.goto(`/draft/${storyId}?token=${token}`);
      await expect(page.getByRole("heading", { name: "Исправить главу" })).toBeVisible();
      if (c.phrase) await expect(page.getByText(`${c.phrase} обновится сам`)).toBeVisible();
      else await expect(page.getByText("Поправьте их здесь.")).toBeVisible();
      await noKorean(page, "черновик");
      await shot(page, `${c.id}-04-draft`);

      await page.goto(`/f/${token}/names`);
      await expect(page.getByRole("heading", { name: "Словарь имён" })).toBeVisible();
      await expect(page.getByText("По-корейски")).toHaveCount(0);
      await expect(page.getByPlaceholder("По-корейски (если знаете)")).toHaveCount(0);
      await noKorean(page, "словарь");
      await shot(page, `${c.id}-05-names`);

      await page.goto(`/book/${token}`);
      await expect(page.getByText(/Готово для книги/)).toBeVisible();
      await noKorean(page, "книга");
      await shot(page, `${c.id}-06-book`);
    });
  });
}

test("демо RU + KR: корейские подписи на месте", async ({ page }) => {
  await page.setViewportSize(SIZE);
  const story = DEMO_STORY_SEEDS.at(0)!;
  const token = DEMO_FAMILY.access_token;

  await page.goto(`/chapter/${story.id}?token=${token}`);
  await expect(page.getByText("카메라를 대면 목소리를 들을 수 있어요")).toBeVisible();
  await shot(page, "kr-02-chapter");
  const href = (await page.getByRole("link", { name: "Открыть страницу голоса" }).getAttribute("href"))!;
  const view = await (await page.request.get(`/api/stories/${story.id}?token=${token}`)).json();
  expect(view.book_langs, "RU + KR — ответ без новых полей").toBeUndefined();
  expect(view.kk).toBeUndefined();

  await page.goto(href);
  await expect(page.getByText("손주들을 위한 가족의 이야기")).toBeVisible();
  await expect(page.getByText("우리 이야기", { exact: true })).toBeVisible();
  await shot(page, "kr-03-listen");

  await page.goto(`/draft/${story.id}?token=${token}`);
  await expect(page.getByText("корейский перевод обновится сам")).toBeVisible();

  await page.goto(`/f/${token}/names`);
  await expect(page.getByText("а корейский перевод этих глав обновится сам")).toBeVisible();
  await expect(page.getByText("· 이름 사전")).toBeVisible();

  await page.goto(`/book/${token}`);
  await expect(page.getByText("우리 이야기", { exact: true })).toBeVisible();
  await shot(page, "kr-06-book");
});
