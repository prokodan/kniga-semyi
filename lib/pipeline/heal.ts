import "server-only";
// #166: главы семьи, которые стоят на шаге, подталкивает сама семья — любым ответом интервью и открытием
// страницы семьи. Раньше эту работу делали только экран главы (если открыт) и workflow kick-stuck, а GitHub
// запускает cron «каждые 10 мин» по факту раз в несколько часов: 25.11 у семьи 8 глав провисели весь вечер.
// Подталкивание = тот же POST /process, что у kick-stuck: аренда шага не даёт запустить шаг дважды,
// а история, которую держит интервью (уточнения), отвечает { waiting } и ничего не тратит.
// Счётчик kick_attempts не трогаем: это не попытка kick-stuck, а «посмотри ещё раз».
import { after } from "next/server";
import { getDbOrNull } from "@/lib/db";
import { STEP_LEASE_MS } from "./engine";
import { needsHeal, HEAL_ACTIVE, HEAL_MAX, HEAL_STALE_MS } from "./heal-rule";

export function healFamily(origin: string, token: string): void {
  const db = getDbOrNull();
  if (!db || !token) return;
  const run = async () => {
    try {
      const { data: fam } = await db.from("families").select("id").eq("access_token", token).maybeSingle();
      if (!fam) return;
      const since = new Date(Date.now() - HEAL_STALE_MS).toISOString();
      const { data } = await db
        .from("stories")
        .select("id, status, updated_at, step_started_at")
        .eq("family_id", (fam as { id: string }).id)
        .in("status", HEAL_ACTIVE)
        .lt("updated_at", since)
        .order("updated_at", { ascending: true })
        .limit(HEAL_MAX);
      const now = Date.now();
      const stale = ((data ?? []) as Parameters<typeof needsHeal>[0][]).filter((s) => needsHeal(s, now, STEP_LEASE_MS));
      await Promise.all(
        stale.map((s) =>
          fetch(`${origin}/api/stories/${encodeURIComponent(s.id)}/process`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-family-token": token },
            body: "{}",
            signal: AbortSignal.timeout(2_500),
          }).catch(() => undefined),
        ),
      );
    } catch (e) {
      console.warn("[heal]", (e as Error).message);
    }
  };
  try {
    after(run);
  } catch {
    // вне запроса Next (тесты, скрипты)
  }
}
