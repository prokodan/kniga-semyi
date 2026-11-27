// #277 древо 2.0: снимки 390 × 844, 430 × 932, 820 × 1180 + страницы древа в PDF — артефакт kiosk-screens, папка tree/.
// Демо Ким и Ли Нина (seed:demo) и синтетическая семья на 40 человек с длинными именами: фикстура
// lib/tree/fixtures/big-family.ts, создаётся ТОЛЬКО в локальной базе e2e (в staging и прод не попадает).
// Проверки: рассказчик и супруга целиком в окне древа, имя не обрезано сверху, страница вбок не листается,
// кнопки ≥ 48 px; «+ ещё» у большой семьи; «Списком»; фото человека (#269) → в карточке и в PDF.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { DEMO_FAMILY, DEMO_KIOSK_FAMILY } from "@/fixtures/demo/family";
import { bigFamily, BIG_FAMILY_ID, BIG_STORYTELLER_ID, bigId } from "@/lib/tree/fixtures/big-family";

const DIR = "e2e-screens/tree";
const SIZES = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "820x1180", width: 820, height: 1180 },
] as const;
const BIG_TOKEN = "b16b16b16b16b16b16b16b16b16b16b16b16b16b16b16b16b16b16b16b16b16b";
/** Агенту без доступа к артефактам — снимки base64 в лог (только ветки z3/tree*) */
const LOG = (process.env.GITHUB_HEAD_REF ?? "").startsWith("z3/tree");
const shots: string[] = [];

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  if (!LOG) return;
  for (const f of shots) console.log(`SCREEN ${f} ${readFileSync(f).toString("base64")} END`);
});

async function snap(page: Page, name: string, opts: { full?: boolean } = {}) {
  mkdirSync(DIR, { recursive: true });
  const path = `${DIR}/${name}.jpg`;
  await page.screenshot({ path, type: "jpeg", quality: 55, fullPage: opts.full ?? false, scale: "css" });
  shots.push(path);
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect.soft(scroll, `${name}: горизонтальная прокрутка страницы (${scroll} > ${width})`).toBeLessThanOrEqual(width);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, a")]
      .filter((b) => !b.closest('[data-testid="tree"]')) // карточки в окне древа масштабируются (щипок, «Всё древо»)
      .map((b) => ({ t: (b.textContent ?? "").trim().slice(0, 30), r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 47.5)
      .map(({ t, r }) => `«${t}» ${Math.round(r.height)} px`),
  );
  expect.soft(small, `${name}: кнопки и ссылки ниже 48 px`).toEqual([]);
}

/** Карточка целиком в окне древа, имя не уходит выше карточки (отзыв 27.11: «Ким Чер Су» обрезан сверху) */
async function expectInView(page: Page, label: RegExp) {
  const card = page.getByTestId("tree-person").filter({ has: page.getByTestId("tree-name") }).and(page.getByRole("button", { name: label }));
  await expect(card).toHaveCount(1);
  const r = await card.evaluate((el) => {
    const vp = el.closest('[data-testid="tree"]')!.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const n = el.querySelector('[data-testid="tree-name"]')!.getBoundingClientRect();
    return { vp: { l: vp.left, r: vp.right, t: vp.top, b: vp.bottom }, c: { l: c.left, r: c.right, t: c.top, b: c.bottom }, nameTop: n.top };
  });
  expect(r.c.l, `${label}: левый край в окне`).toBeGreaterThanOrEqual(r.vp.l - 0.5);
  expect(r.c.r, `${label}: правый край в окне`).toBeLessThanOrEqual(r.vp.r + 0.5);
  expect(r.c.t, `${label}: верх в окне`).toBeGreaterThanOrEqual(r.vp.t - 0.5);
  expect(r.c.b, `${label}: низ в окне`).toBeLessThanOrEqual(r.vp.b + 0.5);
  expect(r.nameTop, `${label}: имя не обрезано сверху`).toBeGreaterThanOrEqual(r.c.t);
}

/** Маленькое JPEG-фото, нарисованное в браузере (ничего не качаем) */
async function testPhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const g = c.getContext("2d")!;
    g.fillStyle = "#4f7a6a"; // jade
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = "#fbf7f0"; // paper
    g.beginPath();
    g.arc(320, 200, 110, 0, Math.PI * 2);
    g.fill();
    g.fillRect(170, 330, 300, 150);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

async function openTree(page: Page, token: string, size: (typeof SIZES)[number]) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/f/${token}/tree`);
  await expect(page.getByRole("heading", { name: /Древо семьи/ })).toBeVisible();
  await expect(page.getByTestId("tree-person").first()).toBeVisible();
  await page.waitForTimeout(150); // раскладка в окне (useLayoutEffect) и шрифты
}

test("древо 2.0: демо Ким — три размера, фото жены, PDF", async ({ page }) => {
  test.setTimeout(150_000);
  const T = DEMO_FAMILY.access_token;
  for (const size of SIZES) {
    await openTree(page, T, size);
    await expectInView(page, /^Ким Чер Су,/);
    await expectInView(page, /^Валентина, жена/);
    await expect(page.getByTestId("tree-row-title").filter({ hasText: "Родители" })).toBeVisible();
    await snap(page, `kim-${size.name}-01-tree`, { full: true });
  }

  // карточка жены: фото (#269) — круглое в карточке; лист снизу с главами
  await openTree(page, T, SIZES[0]);
  await page.getByRole("button", { name: /^Валентина, жена/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("sheet-name")).toContainText("Валентина");
  await sheet.getByTestId("photo-input").setInputFiles({ name: "valentina.jpg", mimeType: "image/jpeg", buffer: await testPhoto(page) });
  await expect(page.getByRole("status")).toContainText("Фото сохранили");
  await expect(page.getByRole("button", { name: /^Валентина, жена/ }).locator("img")).toBeVisible();
  await snap(page, "kim-390x844-02-photo");
  await page.getByRole("button", { name: /^Валентина, жена/ }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Убрать фото" })).toBeVisible();
  await snap(page, "kim-390x844-03-sheet");
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).click();

  // кнопки окна: мельче / всё древо / к рассказчику
  await page.getByRole("button", { name: "Всё древо" }).click();
  await page.waitForTimeout(400);
  await snap(page, "kim-390x844-04-fit");
  await page.getByRole("button", { name: "К рассказчику" }).click();
  await page.waitForTimeout(400);
  await expectInView(page, /^Валентина, жена/);

  // «Списком»
  await page.getByRole("tab", { name: "Списком" }).click();
  await expect(page.getByTestId("tree-list")).toContainText("Ким Чер Су");
  await snap(page, "kim-390x844-05-list", { full: true });

  // PDF: пересобрать (фото жены — на странице древа) и снять страницы древа в PNG
  let built = 0;
  for (let i = 0; i < 12 && built !== 200; i++) {
    const r = await page.request.post(`/api/books/${DEMO_FAMILY.id}/build?token=${T}`);
    built = r.status();
    if (built === 409) await page.waitForTimeout(5000); // книгу собирает соседний тест
    else expect(built, await r.text()).toBe(200);
  }
  const pdf = await page.request.get(`/api/books/${DEMO_FAMILY.id}/pdf?token=${T}`);
  expect(pdf.status()).toBe(200);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/kim-book.pdf`, await pdf.body());
});

test("древо 2.0: Ли Нина (киоск)", async ({ page }) => {
  const T = DEMO_KIOSK_FAMILY.access_token;
  for (const size of [SIZES[0], SIZES[2]]) {
    await openTree(page, T, size);
    await expectInView(page, /^Ли Нина/);
    await snap(page, `li-nina-${size.name}-01-tree`, { full: true });
  }
});

test("древо 2.0: синтетическая семья на 40 человек с длинными именами", async ({ page }) => {
  test.setTimeout(150_000);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  test.skip(!url || !key, "нужна локальная база e2e (supabase start)");
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  const src = bigFamily();
  const must = async (what: string, p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  await must("удалить", db.from("families").delete().eq("id", BIG_FAMILY_ID));
  await must("семья", db.from("families").insert({ id: BIG_FAMILY_ID, name: "Семья Цой · тест древа", access_token: BIG_TOKEN }));
  const st = src.storytellers[0]!;
  await must(
    "рассказчик",
    db.from("storytellers").insert({ id: BIG_STORYTELLER_ID, family_id: BIG_FAMILY_ID, name: st.name, name_ko: st.name_ko, birth_year: st.birth_year, birth_place: st.birth_place }),
  );
  await must(
    "люди",
    db.from("family_entities").insert(
      src.entities.map((e) => ({
        id: e.id,
        family_id: BIG_FAMILY_ID,
        kind: "person",
        name_ru: e.name_ru,
        name_ko: e.name_ko,
        description: e.description,
        story_ids: [],
        source: "family",
        birth_year: e.birth_year,
        death_year: e.death_year,
        gender: e.gender,
      })),
    ),
  );
  await must("рассказчик на древе", db.from("storytellers").update({ entity_id: bigId(15) }).eq("id", BIG_STORYTELLER_ID));
  await must("связи", db.from("family_relations").insert(src.relations.map((r) => ({ ...r, family_id: BIG_FAMILY_ID }))));

  for (const size of SIZES) {
    await openTree(page, BIG_TOKEN, size);
    await expectInView(page, /^Цой Валентин Владиславович,/);
    await expectInView(page, /^Ким Елизавета Александровна, жена/);
    await expect(page.getByTestId("tree-more").first()).toBeVisible(); // ветки двоюродных свёрнуты
    await snap(page, `big40-${size.name}-01-tree`, { full: true });
  }

  // длинное имя: в карточке до 2 строк, в листе — целиком
  await openTree(page, BIG_TOKEN, SIZES[0]);
  await page.getByRole("button", { name: "Всё древо" }).click();
  await page.waitForTimeout(400);
  await snap(page, "big40-390x844-02-fit");
  await page.getByRole("button", { name: "К рассказчику" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Цой Валентин Владиславович,/ }).click();
  await expect(page.getByRole("dialog").getByTestId("sheet-name")).toContainText("Цой Валентин Владиславович");
  await snap(page, "big40-390x844-03-sheet");
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).click();

  // «+ ещё» — ветка разворачивается и встаёт в центр (чипы — под тётями, сбоку: сначала всё древо)
  await page.getByRole("button", { name: "Всё древо" }).click();
  await page.waitForTimeout(400);
  const more = page.getByTestId("tree-more").first();
  const before = await page.getByTestId("tree-person").count();
  await more.click();
  await expect.poll(() => page.getByTestId("tree-person").count()).toBeGreaterThan(before);
  await page.waitForTimeout(300);
  await snap(page, "big40-390x844-04-opened");

  // «Списком» — все 39 на древе, имена целиком
  await page.getByRole("tab", { name: "Списком" }).click();
  const list = page.getByTestId("tree-list");
  await expect(list.getByRole("button")).toHaveCount(39);
  await expect(list).toContainText("Нурмагамбетова Динара Кайратовна");
  await expect(list).toContainText("Ахметжанова Гульжахан");
  await snap(page, "big40-390x844-05-list", { full: true });
});

test("древо 2.0: страницы древа в PDF → PNG", async () => {
  test.setTimeout(120_000);
  const inputs: string[] = [];
  try {
    readFileSync(`${DIR}/kim-book.pdf`);
    inputs.push(`kim=${DIR}/kim-book.pdf`);
  } catch {
    // книгу Ким не собрали — только синтетическая семья
  }
  const out = execFileSync("npx", ["tsx", "scripts/tree-pdf-preview.mts", DIR, ...inputs], { encoding: "utf8", timeout: 110_000 });
  const files = out.trim().split("\n").filter((f) => f.endsWith(".png"));
  expect(files.length).toBeGreaterThanOrEqual(3); // 40 человек: 2 страницы (KR) + 2 (KZ); Ким — 1
  if (inputs.length) expect(files.some((f) => f.includes("pdf-kim"))).toBe(true);
  shots.push(...files);
});
