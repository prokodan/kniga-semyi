import { NextResponse } from "next/server";
import { getBot, getBotConfig, safeEqual } from "@/lib/bot";
import type { TgUpdate } from "@/lib/bot/telegram";

export const dynamic = "force-dynamic";

// Webhook бота-пульта (I16). Telegram присылает секрет в X-Telegram-Bot-Api-Secret-Token
// (задаётся в bot-setup.yml через setWebhook secret_token). Без верного секрета — 401 и тишина.
// Отвечаем 200 даже при ошибке внутри обработки, чтобы Telegram не повторял апдейт по кругу.
export async function POST(req: Request) {
  const cfg = getBotConfig();
  if (!cfg.webhookSecret || !safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), cfg.webhookSecret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const built = getBot();
  if (!built) return NextResponse.json({ ok: false, reason: "TELEGRAM_BOT_TOKEN не задан" }, { status: 503 });

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  try {
    await built.bot.handleUpdate(update);
  } catch (e) {
    console.error("[telegram] update", e instanceof Error ? e.message : "error");
  }
  return NextResponse.json({ ok: true });
}
