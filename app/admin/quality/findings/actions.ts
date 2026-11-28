"use server";
// #354: действия вкладки «Находки» /admin/quality/findings. Каждое проверяет cookie админа (ADMIN_PIN) и флаг quality_loop.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { flag } from "@/lib/flags";
import { isFindingComponent } from "@/lib/quality/findings";
import { isQualityPair, type QualityPair } from "@/lib/quality/types";
import { isAdmin } from "../../ai/_lib/session";
import { canDispatch, digestNow, digestRepo, dispatchPropose } from "./_lib/store";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

function back(pair: string, msg: string, tone: "ok" | "err" = "ok"): never {
  const p = isQualityPair(pair) ? pair : "ru-kk";
  revalidatePath("/admin/quality/findings");
  redirect(`/admin/quality/findings?pair=${p}&tone=${tone}&msg=${encodeURIComponent(msg.slice(0, 300))}`);
}

async function guard(fd: FormData): Promise<QualityPair> {
  const pair = str(fd, "pair");
  if (!(await isAdmin())) redirect("/admin");
  if (!flag("quality_loop")) back(pair, "Контур качества выключен (флаг quality_loop).", "err");
  if (!isQualityPair(pair)) back("ru-kk", "Выберите языковую пару.", "err");
  return pair;
}

export async function digestAction(fd: FormData): Promise<void> {
  const pair = await guard(fd);
  let msg: string;
  let tone: "ok" | "err" = "ok";
  try {
    const r = await digestNow("button", { deadline: Date.now() + 50_000 });
    if (!r) back(pair, "Контур качества выключен (флаг quality_loop).", "err");
    if (r.status === "busy") msg = "Разбор уже идёт (час / закрытие ссылки) — обновите страницу через минуту.";
    else if (r.status === "idle") msg = "Новых отзывов нет — всё уже разобрано.";
    else {
      msg = `Разобрано текстов: ${r.itemsAnalyzed} из ${r.itemsSeen}. Новых находок: ${r.findingsNew}, слито с прежними: ${r.findingsMerged}.`;
      if (r.proposed.length) msg += ` Запущено предложение правки: ${r.proposed.map((p) => `${p.pair} · ${p.component}`).join(", ")}.`;
      if (r.errors.length) {
        msg += ` ${r.errors[0]}`;
        if (r.status === "error" || r.status === "budget") tone = "err";
      }
    }
  } catch (e) {
    console.error("[admin/quality/findings] разбор:", e instanceof Error ? e.message : e);
    msg = "Разбор не удался — прошла ли миграция #354 (workflow migrate)? Попробуйте ещё раз.";
    tone = "err";
  }
  back(pair, msg, tone);
}

export async function proposeAction(fd: FormData): Promise<void> {
  const pair = await guard(fd);
  const c = str(fd, "component");
  const component = isFindingComponent(c) ? c : "";
  if (!canDispatch())
    back(pair, `На этом окружении нет GITHUB_TOKEN — запустите Actions → quality-propose вручную (pair ${pair}${component ? `, component ${component}` : ""}).`, "err");
  try {
    await dispatchPropose(pair, component, "button");
  } catch (e) {
    console.error("[admin/quality/findings] quality-propose:", e instanceof Error ? e.message : e);
    back(pair, "GitHub не принял запуск (нет прав на Actions у токена?) — запустите Actions → quality-propose вручную.", "err");
  }
  back(pair, `Предложение правки ${pair}${component ? ` (${component})` : ""} строится — PR quality/${pair}-… появится через 2–4 минуты.`);
}

export async function setFindingAction(fd: FormData): Promise<void> {
  const pair = await guard(fd);
  const id = str(fd, "id");
  const status = str(fd, "status") === "new" ? "new" : "dismissed";
  if (!/^[0-9a-f-]{36}$/i.test(id)) back(pair, "Нет такой находки.", "err");
  await digestRepo().repo.setFindingStatus([id], status);
  back(pair, status === "dismissed" ? "Находка скрыта — в предложения не попадёт." : "Находка возвращена в новые.");
}
