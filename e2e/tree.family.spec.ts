// #235: древо семьи (флаг family_tree; в e2e FLAGS_ON не задан → все флаги включены). Демо-семья Ким: древо из её
// 7 глав без ИИ, правка (годы, имя отцу, новый человек), «Записать историю жены» → /start с предзаполнением.
// Имя файла *.family.spec.ts — его берут проекты iphone и pixel (playwright.config.ts). Снимки — e2e-screens/tree/.
import { expect, test, type Page } from "@playwright/test";
import { DEMO_FAMILY } from "@/fixtures/demo/family";

const T = DEMO_FAMILY.access_token;

async function shot(page: Page, project: string, name: string) {
  await page.screenshot({ path: `e2e-screens/tree/${project}-${name}.jpg`, type: "jpeg", quality: 60, fullPage: true });
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect.soft(scroll, `${name}: горизонтальная прокрутка страницы (${scroll} > ${width})`).toBeLessThanOrEqual(width);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, a")]
      .map((b) => ({ t: (b.textContent ?? "").trim().slice(0, 30), r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 47.5)
      .map(({ t, r }) => `«${t}» ${Math.round(r.height)} px`),
  );
  expect.soft(small, `${name}: кнопки и ссылки ниже 48 px`).toEqual([]);
}

test("демо: древо семьи — само из глав, правка, «Записать историю жены»", async ({ page }, info) => {
  const p = info.project.name;
  await page.goto(`/f/${T}`);
  await page.getByRole("link", { name: /Древо семьи/ }).click();
  await expect(page.getByRole("heading", { name: /Древо семьи/ })).toBeVisible();

  const people = page.getByTestId("tree-person");
  await expect(people.first()).toBeVisible();
  expect(await people.count()).toBeGreaterThanOrEqual(5); // Ким, жена, папа, мама, брат
  await expect(page.getByRole("button", { name: /Ким Чер Су/ })).toBeVisible();
  const wife = page.getByRole("button", { name: /Валентина, жена/ });
  await expect(wife).toBeVisible();
  await expect(page.getByRole("button", { name: /, папа/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /, мама/ })).toBeVisible();
  await expect(page.getByText("Анна Петровна").first()).toBeVisible(); // «Ещё в рассказах»: учительница — не родня
  await shot(page, p, "01-tree");

  // карточка жены: «Записать историю жены» → /start с её именем
  await wife.click();
  const sheet = page.getByRole("dialog");
  const record = sheet.getByTestId("record-story");
  await expect(record).toHaveText(/Записать историю жены/);
  await shot(page, p, "02-sheet");
  const href = (await record.getAttribute("href"))!;
  expect(href).toContain("/start?");
  expect(href).toContain("storyteller=");
  // #341: пакеты и языки этой семьи (демо Ким — корё-сарам, ru + корё мар, RU + KR)
  const q = new URL(href, "http://x").searchParams;
  expect(q.getAll("pack")).toEqual(["koryo"]);
  expect(q.get("spoken")).toBe("ru,koryo");
  expect(q.get("langs")).toBe("ru,ko");

  // годы жены
  await sheet.getByRole("button", { name: "✎ Исправить" }).click();
  await sheet.getByLabel("Год рождения").fill("1943");
  await shot(page, p, "03-edit");
  await sheet.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("status")).toContainText("Сохранили");
  await expect(page.getByRole("button", { name: /Валентина, жена, 1943/ })).toBeVisible();

  // имя отцу: на древе — имя, подпись «папа» остаётся
  const papa = page.getByRole("button", { name: /, папа/ });
  await papa.click();
  await page.getByRole("dialog").getByRole("button", { name: "✎ Исправить" }).click();
  await page.getByRole("dialog").getByLabel("Имя").fill("Ким Ён Хо");
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("button", { name: /Ким Ён Хо, папа/ })).toBeVisible();

  // добавить человека
  const son = `Ким Олег ${p} ${Date.now().toString(36)}`;
  await page.getByLabel("Имя", { exact: true }).last().fill(son);
  await page.getByLabel("Кем приходится").last().selectOption("son");
  await page.getByLabel("Для кого").last().selectOption({ label: "Ким Чер Су" });
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(`${son}, сын`) })).toBeVisible();
  await shot(page, p, "04-after-edit");

  // вторая книга: /start с предзаполнением
  await page.goto(href);
  await expect(page.locator('input[name="storytellerName"]')).toHaveValue("Валентина");
  await expect(page.getByText(/Вторая книга в семье/)).toBeVisible();
  // #341: анкета не пустая — корё-сарам, корё мар и RU + KR отмечены, поле «Имя по-корейски» на месте
  await expect(page.locator('input[name="packs"][value="koryo"]')).toBeChecked();
  await expect(page.locator('input[name="spoken"][value="ru,koryo"]')).toBeChecked();
  await expect(page.locator('input[name="book"][value="ru,ko"]')).toBeChecked();
  await expect(page.getByLabel(/Имя по-корейски/)).toBeVisible();
  await shot(page, p, "05-start");
});

test("#341: /start со ссылки древа казахской семьи — пакет, язык рассказа и RU + KZ отмечены", async ({ page }) => {
  await page.goto("/start?from=x&book=Книга%20семьи&storyteller=Сәуле&pack=kz&spoken=ru%2Ckk&langs=ru%2Ckk");
  await expect(page.locator('input[name="packs"][value="kz"]')).toBeChecked();
  await expect(page.locator('input[name="packs"][value="koryo"]')).not.toBeChecked();
  await expect(page.locator('input[name="spoken"][value="ru,kk"]')).toBeChecked();
  await expect(page.locator('input[name="book"][value="ru,kk"]')).toBeChecked();
  // чужое значение — как без него: умолчание по пакетам
  await page.goto("/start?pack=kz&spoken=ru%2Ckoryo&langs=xx");
  await expect(page.locator('input[name="spoken"][value="ru"]')).toBeChecked();
  await expect(page.locator('input[name="book"][value="ru,kk"]')).toBeChecked();
});
