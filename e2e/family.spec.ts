// Путь семьи (I13): новая семья — старт → согласие → ответ → уточнение → глава RU | KR → страница голоса по QR;
// демо-семья I12 — правка черновика → книга PDF → оплата (демо) и допы → сказка.
// Микрофон — загрузка файла (запись через MediaRecorder проверяется руками на телефоне).
import { expect, test } from "@playwright/test";
import editFixture from "@/fixtures/ai/edit.json";
import taleFixture from "@/fixtures/ai/tale.json";
import translateFixture from "@/fixtures/ai/translate.json";
import { DEMO_FAMILY, DEMO_STORY_SEEDS, DEMO_TALE } from "@/fixtures/demo/family";
import { audioFile, reloadUntil } from "./support";

const T = DEMO_FAMILY.access_token;
const FOLLOWUP = "А сколько вам тогда было лет и где это было?"; // уточнение заглушки ИИ на короткий ответ

test("новая семья: старт → согласие → ответ → уточнение → глава RU | KR → голос по QR", async ({ page }) => {
  const familyName = `Книга семьи E2E ${Date.now().toString(36)}`;

  await test.step("старт: создать книгу", async () => {
    await page.goto("/start");
    await page.getByLabel("Как назовём книгу?").fill(familyName);
    await page.getByLabel("Имя, как зовут в семье").fill("Бабушка Мария");
    await page.getByLabel("Год рождения").fill("1941");
    await page.getByLabel("Где родились").fill("Уштобе");
    await page.getByLabel(/Имя по-корейски/).fill("김마리아");
    await page.getByRole("button", { name: "Создать книгу" }).click();
    await expect(page.getByRole("heading", { name: "Книга создана ✓" })).toBeVisible();
    await expect(page.getByRole("heading", { name: familyName })).toBeVisible();
  });
  const token = new URL(page.url()).pathname.split("/").pop()!;
  expect(token).toMatch(/^[0-9a-f]{64}$/);

  await test.step("голосовое согласие (файлом)", async () => {
    await page.getByRole("link", { name: "Начать: согласие на запись" }).click();
    await expect(page.getByRole("heading", { name: "Согласие на запись" })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(audioFile("soglasie.wav", 4));
    await expect(page.getByText(/Файл выбран/)).toBeVisible();
    await page.getByRole("button", { name: "Сохранить согласие" }).click();
    await expect(page.getByText("Согласие записано ✓ Спасибо!")).toBeVisible();
    await page.getByRole("link", { name: "Записать первый рассказ" }).click();
  });

  let question = "";
  await test.step("ответ: короткая запись → агент задаёт уточнение", async () => {
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible({ timeout: 30_000 });
    question = (await h1.textContent())!.trim();
    await page.locator('input[type="file"]').setInputFiles(audioFile("otvet.wav", 1));
    await page.getByRole("button", { name: "Отправить рассказ" }).click();
    await expect(page.getByText("Спасибо! Рассказ сохранён.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: FOLLOWUP })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/· уточнение/)).toBeVisible();
  });

  await test.step("ответ на уточнение → следующий вопрос", async () => {
    await page.locator('input[type="file"]').setInputFiles(audioFile("utochnenie.wav", 8));
    await page.getByRole("button", { name: "Отправить рассказ" }).click();
    await expect(page.getByText("Спасибо! Дополнение сохранено.")).toBeVisible();
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).not.toHaveText(FOLLOWUP, { timeout: 60_000 });
    await expect(h1).not.toHaveText(question);
    await expect(page.getByText(/· уточнение/)).toBeHidden();
  });

  await test.step("глава RU | KR", async () => {
    await page.goto(`/f/${token}`);
    const chapter = page.getByRole("link", { name: /^1\. / });
    await reloadUntil(page, () => expect(chapter).toContainText("читать →", { timeout: 2000 }));
    await chapter.click();
    await expect(page.getByRole("heading", { name: editFixture.title })).toBeVisible();
    await page.getByRole("tab", { name: "한국어" }).click();
    await expect(page.getByRole("heading", { name: translateFixture.title_ko })).toBeVisible();
    await page.getByRole("tab", { name: "Русский" }).click();
    await expect(page.getByText("Наведите камеру — и услышите голос")).toBeVisible();
    await expect(page.locator("section svg").first()).toBeVisible();
  });

  await test.step("QR → страница голоса без токена", async () => {
    const href = await page.getByRole("link", { name: "Открыть страницу голоса" }).getAttribute("href");
    expect(href).toMatch(/\/listen\/[0-9a-f-]{36}\?s=/);
    expect(href).not.toContain(token);
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1, name: "Бабушка Мария" })).toBeVisible();
    await expect(page.getByText("김마리아")).toBeVisible();
    await expect(page.locator("audio")).toHaveCount(1);
  });
});

test("демо: правка черновика → глава с новым заголовком", async ({ page }) => {
  const story = DEMO_STORY_SEEDS.at(-1)!;
  const title = `${story.edit.title} · ${test.info().project.name} ${Date.now().toString(36)}`;
  // В правку попадают кнопкой из главы, а не по адресу.
  await page.goto(`/chapter/${story.id}?token=${T}`);
  await page.getByRole("link", { name: /Исправить имена и даты/ }).click();
  await page.waitForURL(/\/draft\//);
  await expect(page.getByRole("heading", { name: "Исправить главу" })).toBeVisible();
  await expect(page.getByLabel("Заголовок главы")).toHaveValue(/\S/);
  await page.getByLabel("Заголовок главы").fill(title);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранить правки?")).toBeVisible();
  await page.getByRole("button", { name: "Да, сохранить" }).click();
  await page.waitForURL(/\/chapter\//, { timeout: 30_000 });
  await reloadUntil(page, () => expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 2000 }));
});

test("демо: книга PDF — открыть, скачать, пересобрать", async ({ page }) => {
  await page.goto(`/book/${T}`);
  await expect(page.getByText(/Книга готова:/)).toBeVisible();
  const href = await page.getByRole("link", { name: "Открыть книгу (PDF)" }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("button", { name: "Пересобрать с новыми главами" }).click();
  await expect(page.getByText(/Книга готова: \d+ стр\./)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "Скачать PDF" })).toBeVisible();
});

test("демо: оплата (демо) → допы → сказка", async ({ page }) => {
  await test.step("выбор книги и допа, «Оплатить (демо)»", async () => {
    // К оплате попадают кнопкой со страницы семьи.
    await page.goto(`/f/${T}`);
    await page.getByRole("link", { name: /Выбрать книгу/ }).click();
    await page.waitForURL(/\/checkout\//);
    const total = page.getByText("Итого").locator("..");
    await page.getByText("Цифровая · семейная").click();
    await expect(page.getByRole("radio", { checked: true })).toHaveValue("digital-2");
    await expect(total).toContainText("14 900 ₸");
    // Сказка для внуков — доп «в подарок» (EXTRAS_KZT.tale = 0): итог не меняется
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await page.getByRole("button", { name: "Оплатить (демо)" }).click();
    await page.waitForURL(new RegExp(`/extras/${T}\\?paid=1`));
  });

  await test.step("допы после оплаты", async () => {
    await expect(page.getByText("Оплачено (демо) · 결제 완료 (데모)")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Спасибо! Книга заказана" })).toBeVisible();
    await expect(page.getByText(/Цифровая · семейная · /)).toBeVisible();
    await page.getByRole("link", { name: "Открыть сказку" }).click();
  });

  await test.step("сказка: листается, картинки на месте, «Написать заново» в mock", async () => {
    await expect(page.getByRole("heading", { name: "Сказка для внуков" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: DEMO_TALE.title })).toBeVisible();
    await page.getByRole("button", { name: "Следующая страница" }).click();
    await expect(page.getByAltText("Картинка к странице 1")).toBeVisible();
    await expect(page.getByText(`1 / ${DEMO_TALE.pages.length}`)).toBeVisible();

    await page.getByRole("button", { name: "Написать сказку заново" }).click();
    await expect(page.getByRole("heading", { level: 2, name: taleFixture.title })).toBeVisible({ timeout: 60_000 });
    // Имени внука не задавали — в сказке не должно появиться выдуманное имя (#44)
    await expect(page.getByText(/^для /)).toHaveCount(0);
  });
});
