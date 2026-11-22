// E2E (I13): главные пути семьи, киоска, кабинета АКНЦ и админки — в AI_MODE=mock на демо-семье I12.
//   npm run e2e                                  # все профили: iPhone (WebKit), Pixel (Chromium), iPad (WebKit)
//   npm run e2e -- --project=iphone              # только семья на iPhone
// Нужен сайт с ЛОКАЛЬНОЙ базой Supabase (supabase start): тесты сбрасывают демо и создают семьи. На облачную базу
// не запускаемся — см. assertLocalDb. В CI всё это делает job e2e в .github/workflows/ci.yml.
import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV } from "./e2e/env";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/** Тесты пишут в базу (сброс демо, новые семьи) — только локальный Supabase или явное разрешение. */
function assertLocalDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url) || process.env.E2E_ALLOW_REMOTE === "1") return;
  throw new Error(`e2e: NEXT_PUBLIC_SUPABASE_URL=${url} — это не локальная база. Запустите supabase start или задайте E2E_ALLOW_REMOTE=1.`);
}
assertLocalDb();

for (const [k, v] of Object.entries(E2E_ENV)) process.env[k] = v; // seed:demo и тесты видят те же значения

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: ci ? 2 : undefined,
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  reporter: ci ? [["list"], ["html", { open: "never" }], ["github"]] : [["list"]],
  use: {
    baseURL,
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    // 1. Демо-семья через npm run seed:demo (как утром перед питчем). Остальные проекты ждут её.
    { name: "setup", testMatch: /demo\.setup\.ts/ },
    // 2. Семья и кабинет центра — телефон (iPhone Safari в первую очередь).
    { name: "iphone", use: { ...devices["iPhone 13"] }, testMatch: /(family|center)\.spec\.ts/, dependencies: ["setup"] },
    {
      name: "pixel",
      // E2E_CHROME — свой Chrome вместо скачанного Chromium (если npx playwright install недоступен)
      use: { ...devices["Pixel 7"], launchOptions: process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {} },
      testMatch: /family\.spec\.ts/,
      dependencies: ["setup"],
    },
    // 3. Киоск АКНЦ — планшет в альбомной ориентации.
    { name: "ipad", use: { ...devices["iPad (gen 7) landscape"] }, testMatch: /kiosk\.spec\.ts/, dependencies: ["setup"] },
    // 4. «Сбросить демо» и /admin/ai — последними: сброс пересоздаёт демо, на котором идут тесты выше.
    { name: "admin", use: { ...devices["iPhone 13"] }, testMatch: /admin\.spec\.ts/, dependencies: ["iphone", "ipad"] },
  ],
  webServer: {
    // В CI сайт уже собран шагом «Сборка»; локально — npm run build заранее (или E2E_SERVER="npm run dev").
    command: process.env.E2E_SERVER ?? `npm run start -- -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !ci,
    timeout: 120_000,
    env: { ...E2E_ENV, NEXT_TELEMETRY_DISABLED: "1" },
    stdout: "pipe",
  },
});
