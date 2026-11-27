// /admin/reviews — ссылки для носителей языка (#232, docs/v2/LANGUAGES.md §3). Вход — ADMIN_PIN (cookie /admin).
// Новая ссылка → /review/<токен> (токен показываем один раз, в базе — хэш); список: проверено, средние оценки, «отозвать».
// Выгрузка отзывов — Actions → reviews-export (target staging | prod) → PR с eval/reviews/*.md и eval/golden/<пара>.jsonl.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Notice, Section, btnGhostCls } from "@/components/admin/ui";
import { env } from "@/lib/env";
import { REVIEW_AXES } from "@/lib/types";
import { isAdmin, isAdminConfigured } from "../ai/_lib/session";
import { AXIS_RU } from "@/eval/reviews/format";
import { linkStats, linkStatus, type LinkStats } from "./_lib/core";
import type { LinkBundle } from "./_lib/repo";
import { setOptions } from "./_lib/sets";
import { reviewStore } from "./_lib/store";
import { revokeLinkAction } from "./actions";
import { CreateLinkForm } from "./CreateLinkForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Носители · админка · Книга семьи", robots: { index: false, follow: false } };

const link = "flex min-h-12 items-center rounded-button border border-line bg-paper px-4 text-sm";
const date = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const STATUS = {
  active: { label: "активна", tone: "ok" },
  expired: { label: "истекла", tone: "off" },
  revoked: { label: "отозвана", tone: "over" },
} as const;

const ACTIONS_URL = "https://github.com/prokodan/kniga-semyi/actions/workflows/reviews-export.yml";

export default async function AdminReviewsPage() {
  if (!isAdminConfigured() || !(await isAdmin())) redirect("/admin");

  let rows: { b: LinkBundle; s: LinkStats }[] | null = null;
  let memory = false;
  try {
    const r = reviewStore();
    memory = r.memory;
    const links = await r.store.links();
    rows = await Promise.all(
      links.map(async (l) => {
        const b = await r.store.bundle(l);
        return { b, s: linkStats(b.items, b.feedback) };
      }),
    );
  } catch (e) {
    console.error("[admin/reviews]", e instanceof Error ? e.message : e);
  }
  const target = env.vercelEnv() === "production" ? "prod" : "staging";

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">Книга семьи · админка</p>
          <h1 className="font-serif text-2xl">Носители языка</h1>
        </div>
        <nav className="flex gap-2 text-sm" aria-label="Разделы админки">
          <Link href="/admin" className={link}>
            Пульт
          </Link>
          <Link href="/admin/families" className={link}>
            Семьи
          </Link>
        </nav>
      </header>

      <Notice tone="info">
        Личная ссылка носителю на языковую пару: он с телефона правит перевод в абзаце, ставит оценки и пишет комментарии. Только вымышленные
        тексты (eval-персонажи, демо, вопросы банка) — главы живых семей сюда не попадают. Отзывы забирает Actions →{" "}
        <a className="underline" href={ACTIONS_URL}>
          reviews-export
        </a>{" "}
        (target <b>{target}</b> — эта база) → PR с eval/reviews и золотым набором.
      </Notice>
      {memory ? <Notice tone="info">База не настроена — ссылки живут в памяти сервера (локальный режим).</Notice> : null}
      {!rows ? <Notice tone="err">Не удалось прочитать ссылки. Если миграция #232 ещё не прошла — запустите workflow migrate.</Notice> : null}

      <Section title="Новая ссылка">
        <CreateLinkForm sets={setOptions()} />
      </Section>

      <Section title="Ссылки" hint="Ссылку целиком мы не храним: потеряли — создайте новую и отзовите старую.">
        {rows && rows.length === 0 ? <p className="text-ink-soft">Ссылок пока нет.</p> : null}
        <ul className="flex flex-col gap-2">
          {(rows ?? []).map(({ b, s }) => {
            const st = STATUS[linkStatus(b.link)];
            const avg = REVIEW_AXES.filter((a) => s.avg[a] !== undefined).map((a) => `${AXIS_RU[a]} ${s.avg[a]!.toFixed(1)}`);
            return (
              <li key={b.link.id} className="flex flex-col gap-2 rounded-card bg-paper-deep p-4 text-sm shadow-card" data-review-link={b.link.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-base">{b.link.reviewer_label}</b>
                  <span>{b.link.pair}</span>
                  <span className="text-ink-soft">{b.link.mode === "texts" ? "тексты" : "вопросы"} · {b.link.items_set}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <p data-testid="review-link-progress">
                  Проверено <b>{s.reviewed}</b> из {s.items}
                  {s.skipped ? ` · пропущено ${s.skipped}` : ""} · правок абзацев {s.edits} · комментариев {s.comments}
                </p>
                <p className="text-ink-soft">{avg.length ? `Средние: ${avg.join(" · ")}` : "Оценок пока нет"}</p>
                <p className="text-xs text-muted">
                  создана {date(b.link.created_at)} · до {date(b.link.expires_at)}
                  {s.lastAt ? ` · последний отзыв ${date(s.lastAt)}` : ""} · id {b.link.id.slice(0, 8)}
                </p>
                {st.label === "активна" ? (
                  <form action={revokeLinkAction}>
                    <input type="hidden" name="id" value={b.link.id} />
                    <button type="submit" className={btnGhostCls}>
                      Отозвать
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Section>
    </main>
  );
}
