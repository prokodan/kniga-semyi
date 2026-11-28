// /admin/quality/checks — вкладка «Проверки» контура качества (#353, docs/v2/QUALITY_LOOP.md §3.2). Вход — ADMIN_PIN.
// Новая ссылка: пара → проверяющий → текст / слова → материал (галочки, теги) → срок → ссылка + QR.
// Таблица ссылок 2.0: открыта / в работе / готово, N из M, отозвать. Старые ссылки #232 — /admin/reviews.
// Флаг quality_loop (только команда), вход по PIN, шапка и вкладки — layout /admin/quality (Q1 #352).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge, Notice, Section, btnGhostCls } from "@/components/admin/ui";
import { flag } from "@/lib/flags";
import { REVIEW_PAIRS } from "@/lib/types";
import { isAdmin, isAdminConfigured } from "@/app/admin/ai/_lib/session";
import { linkStatus, paragraphs } from "@/app/admin/reviews/_lib/core";
import { itemState, linkPhase, progressCount, type ItemState } from "./_lib/core";
import { materialTags } from "./_lib/materials";
import type { CheckBundle } from "./_lib/repo";
import { checkStore, loadMaterials } from "./_lib/store";
import { revokeCheckAction } from "./actions";
import { NewCheckForm, type MaterialOption } from "./NewCheckForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Проверки · качество · админка · Книга семьи", robots: { index: false, follow: false } };

const date = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const PHASE = {
  open: { label: "открыта", tone: "info" },
  work: { label: "в работе", tone: "near" },
  done: { label: "готово", tone: "ok" },
  expired: { label: "истекла", tone: "off" },
  revoked: { label: "отозвана", tone: "over" },
} as const;

const UI_LABEL = { ko: "ko", kk: "kk", ru: "ru" } as const;

function statesOf(b: CheckBundle): ItemState[] {
  const kind = b.link.kind ?? "text";
  return b.items.map((i) =>
    itemState(
      kind,
      { id: i.id, targets: paragraphs(i.model_text), termCount: Array.isArray(i.focus_terms) ? i.focus_terms.length : 0 },
      b.feedback,
      b.link.criteria ?? undefined,
    ),
  );
}

export default async function QualityChecksPage() {
  if (!isAdminConfigured() || !(await isAdmin())) redirect("/admin");

  if (!flag("quality_loop")) return null; // layout сам показывает «выключено на этом окружении»

  const loaded = await Promise.all(REVIEW_PAIRS.map((p) => loadMaterials(p)));
  const source = loaded.some((l) => l.source === "quality") ? "quality" : "sets";
  const options: MaterialOption[] = loaded.flatMap(({ materials }) =>
    materials.map((m) => ({
      id: m.id,
      pair: m.pair,
      originLabel: m.originLabel,
      title: m.title,
      persona: m.persona,
      tags: m.tags,
      terms: m.focusTerms.map((t) => t.term),
      words: m.words,
      preview: m.seed.model_text.slice(0, 160),
    })),
  );
  const tagsByPair = Object.fromEntries(REVIEW_PAIRS.map((p, i) => [p, materialTags(loaded[i]!.materials)]));

  let rows: { b: CheckBundle; states: ItemState[] }[] | null = null;
  let legacy = 0;
  let memory = false;
  try {
    const r = checkStore();
    memory = r.memory;
    const links = await r.store.links();
    legacy = links.filter((l) => !l.kind).length;
    rows = await Promise.all(
      links
        .filter((l) => l.kind)
        .map(async (l) => {
          const b = await r.store.bundle(l);
          return { b, states: statesOf(b) };
        }),
    );
  } catch (e) {
    console.error("[admin/quality/checks]", e instanceof Error ? e.message : e);
  }

  return (
    <>
      <Notice tone="info">
        Личная ссылка проверяющему: с телефона за 15–20 минут — текст целиком (правка абзаца, 5 критериев с подсказками) или только выделенные
        слова. Только вымышленные тексты:{" "}
        {source === "quality" ? (
          <>банк проверок (quality_items).</>
        ) : (
          <>в банке пока нет прогонов этой базы (вкладка «Банк» → «Прогнать») — пока главы прогонов eval по вымышленным персонажам и демо.</>
        )}
      </Notice>
      {memory ? <Notice tone="info">База не настроена — ссылки живут в памяти сервера (локальный режим).</Notice> : null}
      {!rows ? <Notice tone="err">Не удалось прочитать ссылки. Если миграция #353 ещё не прошла — запустите workflow migrate.</Notice> : null}

      <Section title="Новая ссылка">
        <NewCheckForm materials={options} tagsByPair={tagsByPair} />
      </Section>

      <Section title="Ссылки" hint={legacy ? <>Ещё {legacy} старых ссылок (#232) — в /admin/reviews («Носители»).</> : "Ссылку целиком мы не храним: потеряли — создайте новую и отзовите старую."}>
        {rows && rows.length === 0 ? <p className="text-ink-soft">Ссылок пока нет.</p> : null}
        {rows && rows.length ? (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-2 font-normal">Кто</th>
                  <th className="py-2 pr-2 font-normal">Пара · что</th>
                  <th className="py-2 pr-2 font-normal">Статус</th>
                  <th className="py-2 pr-2 font-normal">Прогресс</th>
                  <th className="py-2 pr-2 font-normal">Срок</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ b, states }) => {
                  const st = linkStatus(b.link);
                  const phase = st === "active" ? linkPhase(states, b.link.completed_at) : st;
                  const p = PHASE[phase];
                  const prog = progressCount(states);
                  const skipped = states.filter((s) => s === "skipped").length;
                  return (
                    <tr key={b.link.id} className="border-b border-line align-middle" data-check-link={b.link.id}>
                      <td className="py-2 pr-2">
                        <b>{b.link.reviewer_label}</b>
                        <span className="block text-xs text-muted">интерфейс {b.link.ui_lang ? UI_LABEL[b.link.ui_lang] : "—"}</span>
                      </td>
                      <td className="py-2 pr-2">
                        {b.link.pair} · {b.link.kind === "terms" ? "слова" : "текст"}
                        <span className="block text-xs text-muted">id {b.link.id.slice(0, 8)}</span>
                      </td>
                      <td className="py-2 pr-2" data-testid="check-phase">
                        <Badge tone={p.tone}>{p.label}</Badge>
                      </td>
                      <td className="py-2 pr-2" data-testid="check-progress">
                        {prog.done} из {prog.total}
                        {skipped ? <span className="block text-xs text-muted">пропущено {skipped}</span> : null}
                      </td>
                      <td className="py-2 pr-2 text-xs text-ink-soft">
                        {date(b.link.created_at)} → {date(b.link.expires_at)}
                      </td>
                      <td className="py-2">
                        {st === "active" ? (
                          <form action={revokeCheckAction}>
                            <input type="hidden" name="id" value={b.link.id} />
                            <button type="submit" className={btnGhostCls}>
                              Отозвать
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>
    </>
  );
}
