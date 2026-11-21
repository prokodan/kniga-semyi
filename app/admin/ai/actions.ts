"use server";
// Server actions админки ИИ. Каждое действие проверяет cookie админа на сервере.
// Пишут только ai_routes / ai_providers; роутер читает их на каждом вызове → применяется сразу.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AI_STEPS, type AiStep } from "@/lib/ai/types";
import { env } from "@/lib/env";
import { getAdminSource } from "./_lib/data";
import { pinMatches } from "./_lib/pin";
import {
  AdminEditError,
  checkPinned,
  moveEntry,
  parseOptionalNumber,
  parseThresholdPct,
  setEntryLimits,
  type EntryRef,
} from "./_lib/routes";
import { endAdminSession, isAdmin, startAdminSession } from "./_lib/session";

const PATH = "/admin/ai";

function back(message: string, anchor?: string, kind: "ok" | "err" = "ok"): never {
  const q = new URLSearchParams({ [kind]: message });
  if (anchor) q.set("at", anchor);
  redirect(`${PATH}?${q.toString()}${anchor ? `#${anchor}` : ""}`);
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};

function stepOf(fd: FormData): AiStep {
  const step = str(fd, "step");
  if (!(AI_STEPS as readonly string[]).includes(step)) throw new AdminEditError("Неизвестный шаг.");
  return step as AiStep;
}

function refOf(fd: FormData): EntryRef {
  return { index: Number(str(fd, "index")), provider: str(fd, "provider"), model: str(fd, "model") };
}

/** Обёртка: проверка входа, выполнение, сообщение пользователю. */
async function guarded(anchor: string, fn: () => Promise<string>): Promise<never> {
  if (!(await isAdmin())) back("Сессия истекла — введите PIN ещё раз.", undefined, "err");
  let message: string;
  try {
    message = await fn();
  } catch (e) {
    const text = e instanceof AdminEditError ? e.message : "Не удалось сохранить. Попробуйте ещё раз.";
    if (!(e instanceof AdminEditError)) console.error("[admin/ai]", e instanceof Error ? e.message : e);
    back(text, anchor, "err");
  }
  revalidatePath(PATH);
  back(message, anchor);
}

// ---------------- Вход ----------------

export async function login(fd: FormData) {
  const pin = env.adminPin();
  if (!pinMatches(pin, str(fd, "pin"))) {
    // Небольшая пауза против перебора
    await new Promise((r) => setTimeout(r, 800));
    back("Неверный PIN.", undefined, "err");
  }
  await startAdminSession();
  redirect(PATH);
}

export async function logout() {
  await endAdminSession();
  redirect(PATH);
}

// ---------------- Провайдеры ----------------

export async function toggleProvider(fd: FormData) {
  const provider = str(fd, "provider");
  const enabled = str(fd, "enabled") === "true";
  return guarded(`provider-${provider}`, async () => {
    await getAdminSource().saveProvider(provider, { enabled });
    return enabled ? `${provider} включён.` : `${provider} выключен — роутер его пропускает.`;
  });
}

export async function saveProviderLimits(fd: FormData) {
  const provider = str(fd, "provider");
  return guarded(`provider-${provider}`, async () => {
    const daily = parseOptionalNumber(fd.get("daily_budget_usd"), { max: 10_000, label: "Бюджет дня" });
    const monthly = parseOptionalNumber(fd.get("monthly_budget_usd"), { max: 100_000, label: "Бюджет месяца" });
    const cooldown = parseOptionalNumber(fd.get("cooldown_minutes"), { max: 1440, int: true, label: "Остывание" });
    await getAdminSource().saveProvider(provider, {
      daily_budget_usd: daily,
      monthly_budget_usd: monthly,
      cooldown_minutes: cooldown ?? 0,
    });
    return `Лимиты ${provider} сохранены.`;
  });
}

// ---------------- Маршруты шагов ----------------

export async function toggleRoute(fd: FormData) {
  return guarded(`step-${str(fd, "step")}`, async () => {
    const step = stepOf(fd);
    const enabled = str(fd, "enabled") === "true";
    await getAdminSource().saveRoute(step, { enabled });
    return enabled ? `Шаг ${step} включён.` : `Шаг ${step} выключен — вызовы получат «ИИ недоступен».`;
  });
}

export async function pinProvider(fd: FormData) {
  return guarded(`step-${str(fd, "step")}`, async () => {
    const step = stepOf(fd);
    const source = getAdminSource();
    const route = await source.getRoute(step);
    const raw = str(fd, "pinned");
    const pinned = checkPinned(route, raw === "" ? null : raw);
    await source.saveRoute(step, { pinned_provider: pinned });
    return pinned ? `Шаг ${step} закреплён за ${pinned}.` : `Закрепление шага ${step} снято.`;
  });
}

export async function moveRouteEntry(fd: FormData) {
  return guarded(`step-${str(fd, "step")}`, async () => {
    const step = stepOf(fd);
    const source = getAdminSource();
    const route = await source.getRoute(step);
    const dir = str(fd, "dir") === "up" ? "up" : "down";
    await source.saveRoute(step, { providers: moveEntry(route.providers, refOf(fd), dir) });
    return `Порядок шага ${step} обновлён.`;
  });
}

export async function saveRouteEntry(fd: FormData) {
  return guarded(`step-${str(fd, "step")}`, async () => {
    const step = stepOf(fd);
    const source = getAdminSource();
    const route = await source.getRoute(step);
    const daily_limit = parseOptionalNumber(fd.get("daily_limit"), { max: 1_000_000, int: true, label: "Квота в сутки" });
    const threshold = parseThresholdPct(fd.get("threshold_pct"));
    await source.saveRoute(step, { providers: setEntryLimits(route.providers, refOf(fd), { daily_limit, threshold }) });
    return `Квота ${str(fd, "model")} в шаге ${step} сохранена.`;
  });
}
