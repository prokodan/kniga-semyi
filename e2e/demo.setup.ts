// Демо-семья I12 перед тестами — тем же путём, что утром перед питчем: npm run seed:demo.
// Книгу собирает запущенный сайт (PROD_URL = адрес тестов), поэтому setup идёт после webServer.
import { execFileSync } from "node:child_process";
import { test as setup } from "@playwright/test";

setup("npm run seed:demo — «Семья Ким · пример» и история киоска", async ({ baseURL }) => {
  setup.setTimeout(120_000);
  const out = execFileSync("npm", ["run", "--silent", "seed:demo"], {
    env: { ...process.env, PROD_URL: baseURL },
    encoding: "utf8",
    timeout: 110_000,
  });
  console.info(out.trim());
});
