import { NextResponse } from "next/server";
import { getBot, getBotConfig, notifySchema, safeEqual } from "@/lib/bot";

export const dynamic = "force-dynamic";

// Приём событий из GitHub Actions (I16): заголовок X-Bot-Notify-Secret = BOT_NOTIFY_SECRET.
// Тело: { event, status?, text?, url? }. Бот сам решает по bot_settings, слать ли сообщение.
// 200 — событие принято (в том числе отфильтровано), и workflow НЕ шлёт фолбэк напрямую.
// Не 200 — workflow отправит сообщение напрямую через sendMessage, как раньше.
export async function POST(req: Request) {
  const cfg = getBotConfig();
  if (!cfg.notifySecret || !safeEqual(req.headers.get("x-bot-notify-secret"), cfg.notifySecret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const built = getBot();
  if (!built || !cfg.chatId) {
    return NextResponse.json({ ok: false, reason: "бот не настроен" }, { status: 503 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "тело не JSON" }, { status: 400 });
  }
  const parsed = notifySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, reason: "неизвестное событие" }, { status: 400 });

  try {
    const result = await built.bot.handleNotify(parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[telegram] notify", e instanceof Error ? e.message : "error");
    return NextResponse.json({ ok: false, reason: "не удалось отправить" }, { status: 502 });
  }
}
