// Общие значения e2e (I13): их видят и playwright.config.ts (окружение сайта), и тесты.
export const E2E_ENV = {
  AI_MODE: "mock",
  ADMIN_PIN: process.env.ADMIN_PIN || "246810",
  KIOSK_PIN: process.env.KIOSK_PIN || "1357",
  STAGE_MODE: "",
} as const;
