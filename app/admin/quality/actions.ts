"use server";
// #352: действия вкладки «Банк» /admin/quality. Каждое проверяет cookie админа (ADMIN_PIN) и флаг quality_loop на сервере.
// Только вымышленные данные: ручной ввод, генерация quality_generate и сид — никогда не главы семей.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ai } from "@/lib/ai";
import { createGithub } from "@/lib/bot/github";
import { flag } from "@/lib/flags";
import { cleanFocus, cleanTags, defaultPack, validateManualPersona, validateManualText } from "@/lib/quality/core";
import { generateBank } from "@/lib/quality/generate";
import { NUANCE_TAGS, isQualityPair, type QualityKind, type QualityPair } from "@/lib/quality/types";
import { isAdmin } from "../ai/_lib/session";
import { QUALITY_RUN_WORKFLOW, qualityRepo } from "./_lib/store";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

function back(pair: string, msg: string, tone: "ok" | "err" = "ok"): never {
  const p = isQualityPair(pair) ? pair : "ru-ko";
  revalidatePath("/admin/quality");
  redirect(`/admin/quality?pair=${p}&tone=${tone}&msg=${encodeURIComponent(msg.slice(0, 300))}`);
}

async function guard(fd: FormData): Promise<QualityPair> {
  const pair = str(fd, "pair");
  if (!(await isAdmin())) redirect("/admin");
  if (!flag("quality_loop")) back(pair, "Контур качества выключен (флаг quality_loop).", "err");
  if (!isQualityPair(pair)) back("ru-ko", "Выберите языковую пару.", "err");
  return pair;
}

const tagsOf = (fd: FormData) => cleanTags(fd.getAll("tags").filter((v) => typeof v === "string" && (NUANCE_TAGS as readonly string[]).includes(v)));

export async function addPersonaAction(fd: FormData): Promise<void> {
  const pair = await guard(fd);
  const input = { name: str(fd, "name"), bio: str(fd, "bio"), speech_style: str(fd, "speech_style") };
  const err = validateManualPersona(input);
  if (err) back(pair, err, "err");
  try {
    await qualityRepo().repo.addPersona({ pair, pack: str(fd, "pack") || defaultPack(pair), ...input, tags: tagsOf(fd), source: "manual" });
  } catch (e) {
    console.error("[admin/quality] личность:", e instanceof Error ? e.message : e);
    back(pair, "Не удалось сохранить личность. Прошла ли миграция (workflow migrate)?", "err");
  }
  back(pair, `Личность «${input.name}» добавлена в «Новые».`);
}

export async function addTextAction(fd: FormData): Promise<void> {
  const pair = await guard(fd);
  const text_src = str(fd, "text_src");
  const tags = tagsOf(fd);
  const err = validateManualText({ text_src, tags });
  if (err) back(pair, err, "err");
  const personaId = str(fd, "persona_id");
  try {
    await qualityRepo().repo.addText({
      pair,
      persona_id: /^[0-9a-f-]{36}$/i.test(personaId) ? personaId : null,
      event: str(fd, "event").slice(0, 200),
      text_src,
      nuance_tags: tags,
      focus_terms: cleanFocus(str(fd, "focus_terms").split(/[,;\n]/), text_src),
      source: "manual",
    });
  } catch (e) {
    console.error("[admin/quality] текст:", e instanceof Error ? e.message : e);
    back(pair, "Не удалось сохранить текст. Прошла ли миграция (workflow migrate)?", "err");
  }
  back(pair, "Текст добавлен в «Новые».");
}

export async function generateAction(fd: FormData): Promise<void> {
  const pair = await guard(fd);
  const kind: QualityKind = str(fd, "kind") === "persona" ? "persona" : "text";
  const n = Number(str(fd, "n") || 3);
  const personaId = str(fd, "persona_id");
  let msg: string;
  let tone: "ok" | "err" = "ok";
  try {
    const r = await generateBank(
      qualityRepo().repo,
      ai,
      { kind, pair, n: Number.isFinite(n) ? n : 3, tags: tagsOf(fd), ...(/^[0-9a-f-]{36}$/i.test(personaId) ? { personaId } : {}) },
      { deadline: Date.now() + 55_000 },
    );
    const what = kind === "persona" ? "личностей" : "текстов";
    msg = r.added ? `Сгенерировано ${what}: ${r.added} — они в «Новых».` : `Ничего не сгенерировано.`;
    if (r.failed) {
      msg += ` Не получилось вызовов: ${r.failed} (${r.errors[0] ?? "ошибка ИИ"}).`;
      if (!r.added) tone = "err";
    }
  } catch (e) {
    console.error("[admin/quality] генерация:", e instanceof Error ? e.message : e);
    msg = "Генерация не удалась — ИИ недоступен или нет миграции. Попробуйте ещё раз или меньше N.";
    tone = "err";
  }
  back(pair, msg, tone);
}

export async function setStatusAction(fd: FormData): Promise<void> {
  const pair = await guard(fd);
  const kind: QualityKind = str(fd, "kind") === "persona" ? "persona" : "text";
  const id = str(fd, "id");
  const status = str(fd, "status") === "archived" ? "archived" : "active";
  if (!/^[0-9a-f-]{36}$/i.test(id)) back(pair, "Нет такой карточки.", "err");
  await qualityRepo().repo.setStatus(kind, [id], status);
  back(pair, status === "archived" ? "Убрано в архив — в прогоны больше не попадёт." : "Возвращено из архива.");
}

export async function runAction(fd: FormData): Promise<void> {
  const pair = await guard(fd);
  const kind = ["persona", "text"].includes(str(fd, "kind")) ? str(fd, "kind") : "all";
  const token = process.env.GITHUB_TOKEN;
  if (!token) back(pair, "На этом окружении нет GITHUB_TOKEN — запустите Actions → quality-run вручную (кнопка «Run workflow»).", "err");
  try {
    const gh = createGithub({ repo: process.env.GITHUB_REPO ?? "prokodan/kniga-semyi", token });
    await gh.dispatch(QUALITY_RUN_WORKFLOW, { action: "run", target: "staging", pair, kind });
  } catch (e) {
    console.error("[admin/quality] quality-run:", e instanceof Error ? e.message : e);
    back(pair, "GitHub не принял запуск (нет прав на Actions у токена?) — запустите Actions → quality-run вручную.", "err");
  }
  back(pair, `Прогон ${pair} запущен на staging. Итог — через 5–15 минут в «Последних прогонах» и в Actions → quality-run.`);
}
