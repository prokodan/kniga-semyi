"use server";
// #232: действия /admin/reviews. Каждое проверяет cookie админа (ADMIN_PIN) на сервере.
// Токен новой ссылки возвращается только в ответе действия (показываем один раз) — не в адресе, не в логах.
import { revalidatePath } from "next/cache";
import { requestOrigin } from "@/lib/book/chapter";
import { env } from "@/lib/env";
import { isAdmin } from "../ai/_lib/session";
import { MODES, isReviewPair } from "./_lib/core";
import { ReviewLinkError, createReviewLink, reviewStore } from "./_lib/store";

export type CreateState =
  | { kind: "idle" }
  | { kind: "ok"; url: string; items: number; label: string; pair: string }
  | { kind: "err"; message: string };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export async function createLinkAction(_prev: CreateState, fd: FormData): Promise<CreateState> {
  if (!(await isAdmin())) return { kind: "err", message: "Сессия истекла — войдите по PIN в /admin." };
  const pair = str(fd, "pair");
  const mode = str(fd, "mode");
  if (!isReviewPair(pair)) return { kind: "err", message: "Выберите языковую пару." };
  if (!(MODES as readonly string[]).includes(mode)) return { kind: "err", message: "Выберите режим." };
  try {
    const r = await createReviewLink({
      pair,
      mode: mode as (typeof MODES)[number],
      setId: str(fd, "set"),
      reviewer: str(fd, "reviewer"),
      days: Number(str(fd, "days") || 14),
    });
    const origin = (env.prodUrl() ?? (await requestOrigin())).replace(/\/+$/, "");
    revalidatePath("/admin/reviews");
    return { kind: "ok", url: `${origin}/review/${r.token}`, items: r.items, label: r.link.reviewer_label, pair };
  } catch (e) {
    if (e instanceof ReviewLinkError) return { kind: "err", message: e.message };
    console.error("[admin/reviews] создание ссылки:", e instanceof Error ? e.message : e);
    return { kind: "err", message: "Не удалось создать ссылку. Проверьте, прошла ли миграция (workflow migrate), и попробуйте ещё раз." };
  }
}

export async function revokeLinkAction(fd: FormData): Promise<void> {
  if (!(await isAdmin())) return;
  const id = str(fd, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await reviewStore().store.revokeLink(id);
  revalidatePath("/admin/reviews");
}
