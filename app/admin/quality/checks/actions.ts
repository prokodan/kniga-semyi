"use server";
// #353: действия вкладки «Проверки». Каждое проверяет cookie админа (ADMIN_PIN) и флаг quality_loop на сервере.
// Токен новой ссылки возвращается только в ответе действия (показываем один раз вместе с QR) — не в логах.
import { revalidatePath } from "next/cache";
import { requestOrigin } from "@/lib/book/chapter";
import { qrSvg } from "@/lib/book/qr";
import { env } from "@/lib/env";
import { flag } from "@/lib/flags";
import { isAdmin } from "@/app/admin/ai/_lib/session";
import { isReviewPair } from "@/app/admin/reviews/_lib/core";
import { isCheckKind, isUiLang } from "./_lib/core";
import { CheckLinkError, checkStore, createCheckLink } from "./_lib/store";

export type CreateCheckState =
  | { kind: "idle" }
  | { kind: "ok"; url: string; qr: string; items: number; label: string; pair: string; mode: string }
  | { kind: "err"; message: string };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

const PATH = "/admin/quality/checks";

export async function createCheckAction(_prev: CreateCheckState, fd: FormData): Promise<CreateCheckState> {
  if (!(await isAdmin())) return { kind: "err", message: "Сессия истекла — войдите по PIN в /admin." };
  if (!flag("quality_loop")) return { kind: "err", message: "Вкладка включается флагом quality_loop (превью / staging)." };
  const pair = str(fd, "pair");
  const kind = str(fd, "kind");
  const ui = str(fd, "ui_lang");
  if (!isReviewPair(pair)) return { kind: "err", message: "Выберите языковую пару." };
  if (!isCheckKind(kind)) return { kind: "err", message: "Выберите, что проверять." };
  if (!isUiLang(ui)) return { kind: "err", message: "Выберите язык интерфейса проверяющего." };
  const ids = fd.getAll("item").filter((v): v is string => typeof v === "string" && v.length < 120);
  try {
    const r = await createCheckLink({ pair, kind, uiLang: ui, reviewer: str(fd, "reviewer"), days: Number(str(fd, "days") || 14), ids });
    const origin = (env.prodUrl() ?? (await requestOrigin())).replace(/\/+$/, "");
    const url = `${origin}/review/${r.token}`;
    revalidatePath(PATH);
    return { kind: "ok", url, qr: (await qrSvg(url)).replace("QR-код: голос рассказчика", "QR-код: ссылка проверяющему"), items: r.items, label: r.link.reviewer_label, pair, mode: kind };
  } catch (e) {
    if (e instanceof CheckLinkError) return { kind: "err", message: e.message };
    console.error("[admin/quality/checks] создание ссылки:", e instanceof Error ? e.message : e);
    return { kind: "err", message: "Не удалось создать ссылку. Проверьте, прошла ли миграция #353 (workflow migrate), и попробуйте ещё раз." };
  }
}

export async function revokeCheckAction(fd: FormData): Promise<void> {
  if (!(await isAdmin())) return;
  const id = str(fd, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await checkStore().store.revoke(id);
  revalidatePath(PATH);
}
