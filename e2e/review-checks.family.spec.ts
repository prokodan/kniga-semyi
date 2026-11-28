// #353 (v2 Q2): /admin/quality/checks → ссылка проверяющему → /review 2.0 с телефона.
//   1) поток: создать ссылку «текст» (2 текста) → пройти оба (правка абзаца с diff, 5 критериев) → готово;
//      ссылка «слова» (1 текст) → верно / неверно → как правильно → готово; в таблице «готово, N из M»; отозвать → закрыта.
//   2) экраны (только проект iphone): 390×844 и 430×932 × ko и kk × «текст» и «слова» — снимки e2e-screens/review/*.jpg,
//      без горизонтальной прокрутки, кнопки ≥ 48 px. В CI флаги включены все (quality_loop тоже).
import { expect, test, type Page } from "@playwright/test";
import { adminLogin } from "./support";

const PATH = "/admin/quality/checks";

/** Клиентские компоненты гидратированы (клик до гидратации React не увидит). */
async function ready(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function openAdmin(page: Page) {
  await adminLogin(page, PATH);
  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: "Проверки", exact: true })).toBeVisible();
  await ready(page);
}

/** Новая ссылка → путь /review/<токен>. */
async function createLink(page: Page, o: { pair: "ru-ko" | "ru-kk"; kind: "text" | "terms"; ui?: "ko" | "kk" | "ru"; reviewer: string; count: number }) {
  await openAdmin(page);
  await page.locator(`input[name=pair][value="${o.pair}"]`).check();
  await page.getByLabel(/Имя/).fill(o.reviewer);
  if (o.ui) await page.getByLabel("Язык интерфейса").selectOption(o.ui);
  await page.locator(`input[name=kind][value="${o.kind}"]`).check();
  const boxes = page.locator("[data-material] input[type=checkbox]:not([disabled])");
  await expect(boxes.first()).toBeVisible();
  for (let i = 0; i < o.count; i++) await boxes.nth(i).check();
  await expect(page.getByTestId("check-picked")).toContainText(`Отмечено ${o.count}`);
  await page.getByRole("button", { name: /Создать ссылку/ }).click();
  const url = (await page.getByTestId("check-url").textContent())?.trim() ?? "";
  expect(url).toMatch(/\/review\/[A-Za-z0-9_-]{32}$/);
  await expect(page.locator("[data-testid=check-created] svg")).toBeVisible();
  return new URL(url).pathname;
}

async function saved(page: Page) {
  await expect(page.getByTestId("review2-status")).toContainText("✓");
}

async function rateAll(page: Page, value: number) {
  const sets = page.locator("fieldset[data-axis]");
  await expect(sets).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await sets.nth(i).getByRole("button").nth(value - 1).click();
    await expect(sets.nth(i).getByRole("button").nth(value - 1)).toHaveAttribute("aria-pressed", "true");
  }
  await saved(page);
}

async function answerTerms(page: Page) {
  const rows = page.locator("[data-term]");
  const n = await rows.count();
  expect(n).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < n; i++) {
    if (i === 1) {
      await page.getByTestId(`term-bad-${i}`).click();
      await page.getByTestId(`term-fix-${i}`).fill("тест-правка");
      await page.getByTestId(`term-fix-${i}`).blur();
    } else {
      await page.getByTestId(`term-ok-${i}`).click();
    }
    await saved(page);
  }
}

test("Проверки: ссылка «текст» (2) и «слова» (1) → пройти с телефона → готово → отозвать", async ({ page }, info) => {
  const who = info.project.name === "pixel" ? "Пётр Хван" : "Ирина Фе";
  const label = info.project.name === "pixel" ? "П. Х." : "И. Ф.";

  // ── текст: ko ──
  const textPath = await createLink(page, { pair: "ru-ko", kind: "text", reviewer: who, count: 2 });
  await page.goto(textPath);
  await ready(page);
  await expect(page.getByTestId("review2-intro")).toHaveAttribute("data-kind", "text");
  await expect(page.getByTestId("review2-example")).toBeVisible();
  await page.getByTestId("review2-start").click();
  await expect(page.getByTestId("review2-item")).toHaveAttribute("data-index", "0");
  await page.getByTestId("para-edit-0").click();
  const ta = page.getByTestId("para-text");
  await ta.fill(`${await ta.inputValue()} 고침`);
  await expect(page.getByTestId("para-diff")).toBeVisible();
  await page.getByTestId("para-save").click();
  await saved(page);
  await expect(page.locator('[data-paragraph="0"] [data-testid=para-diff]')).toContainText("고침");
  await rateAll(page, 4);
  await expect(page.getByTestId("review2-progress")).toContainText("2개 중 1개");
  await page.getByTestId("review2-next").click();
  await expect(page.getByTestId("review2-item")).toHaveAttribute("data-index", "1");
  await rateAll(page, 5);
  await page.getByTestId("review2-finish").click();
  await expect(page.getByTestId("review2-done")).toBeVisible();
  await saved(page);
  await expect(page.getByTestId("review2-progress")).toContainText("2개 중 2개");

  // возврат по той же ссылке — всё сохранилось
  await page.reload();
  await ready(page);
  await expect(page.getByTestId("review2-start")).toContainText("2");

  // ── слова: kk ──
  const termsPath = await createLink(page, { pair: "ru-kk", kind: "terms", reviewer: who, count: 1 });
  await page.goto(termsPath);
  await ready(page);
  await expect(page.getByTestId("review2-intro")).toHaveAttribute("data-kind", "terms");
  await expect(page.getByTestId("review2-intro")).toContainText("Сізден не керек");
  await page.getByTestId("review2-start").click();
  await expect(page.locator("mark[data-term-mark]").first()).toBeVisible();
  await answerTerms(page);
  await page.getByTestId("review2-finish").click();
  await expect(page.getByTestId("review2-done")).toContainText("1");
  await saved(page);

  // ── таблица: готово, N из M → отозвать ──
  await openAdmin(page);
  const textRow = page.locator("[data-check-link]").filter({ hasText: label }).filter({ hasText: "ru-ko · текст" }).first();
  await expect(textRow.getByTestId("check-phase")).toContainText("готово");
  await expect(textRow.getByTestId("check-progress")).toContainText("2 из 2");
  const termsRow = page.locator("[data-check-link]").filter({ hasText: label }).filter({ hasText: "ru-kk · слова" }).first();
  await expect(termsRow.getByTestId("check-phase")).toContainText("готово");
  await expect(termsRow.getByTestId("check-progress")).toContainText("1 из 1");
  await textRow.getByRole("button", { name: "Отозвать" }).click();
  await expect(textRow.getByTestId("check-phase")).toContainText("отозвана");
  await page.goto(textPath);
  await expect(page.getByTestId("review-closed")).toBeVisible();
});

const SCREENS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
] as const;

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `e2e-screens/review/${name}.jpg`, type: "jpeg", quality: 55, fullPage: true });
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect.soft(scroll, `${name}: горизонтальная прокрутка (${scroll} > ${width})`).toBeLessThanOrEqual(width);
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => ({ t: (b.textContent ?? "").trim().slice(0, 30), r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.right > window.innerWidth + 1 || r.left < -1 || r.height < 47.5))
      .map(({ t, r }) => `«${t}» ${Math.round(r.left)}…${Math.round(r.right)} × ${Math.round(r.height)} px`),
  );
  expect.soft(bad, `${name}: кнопки за краем экрана или ниже 48 px`).toEqual([]);
}

test("экраны /review 2.0: 390×844 и 430×932 × ko / kk × текст / слова", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "снимки — один раз, в проекте iphone");
  test.setTimeout(180_000);
  const links: { lang: "ko" | "kk"; kind: "text" | "terms"; path: string }[] = [];
  for (const lang of ["ko", "kk"] as const)
    for (const kind of ["text", "terms"] as const)
      links.push({ lang, kind, path: await createLink(page, { pair: lang === "ko" ? "ru-ko" : "ru-kk", kind, reviewer: "Экран Тест", count: 2 }) });

  for (const vp of SCREENS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const l of links) {
      const base = `${vp.name}-${l.lang}-${l.kind}`;
      await page.goto(l.path);
      await ready(page);
      await expect(page.getByTestId("review2-intro")).toBeVisible();
      await shot(page, `${base}-1-intro`);
      await page.getByTestId("review2-start").click();
      await expect(page.getByTestId("review2-item")).toBeVisible();
      await shot(page, `${base}-2-item`);
      if (l.kind === "text") {
        await page.getByTestId("para-edit-0").click();
        await page.getByTestId("para-text").fill("테스트 수정 · түзету");
        await shot(page, `${base}-3-edit`);
        await page.getByRole("button", { name: /^(취소|Болдырмау)/ }).click();
      } else {
        await page.getByTestId("term-bad-0").click();
        await shot(page, `${base}-3-wrong`);
        await page.getByTestId("term-bad-0").click();
      }
      await page.getByTestId("review2-skip").click();
      await expect(page.getByTestId("review2-item")).toHaveAttribute("data-index", "1");
      await page.getByTestId("review2-skip").click();
      await expect(page.getByTestId("review2-done")).toBeVisible();
      await shot(page, `${base}-4-done`);
    }
  }
});
