"use client";
// #232: экран носителя — тексты по одному: абзац оригинала | абзац перевода, тап → правка, оценки 1–5, комментарий,
// «не знаю, пропустить». Каждое действие сразу уходит в POST /api/review (токен — в заголовке), можно закрыть и вернуться.
import { useMemo, useState } from "react";
import type { BookLang, ReviewAxis, ReviewRatings } from "@/lib/types";
import type { L, ReviewDictionary } from "../_lib/strings";

export interface ClientItem {
  id: string;
  title: string | null;
  kind: "chapter" | "question";
  paragraphs: { source: string; target: string }[];
}

export interface ClientFeedback {
  paragraph: number;
  edited_text: string | null;
  ratings: ReviewRatings;
  comment: string | null;
  skipped: boolean;
}

const AXES: ReviewAxis[] = ["meaning", "grammar", "natural", "respect", "names"];
const btn = "flex min-h-12 items-center justify-center rounded-button px-5 text-base";

function Bi({ l, className = "" }: { l: L; className?: string }) {
  return (
    <span className={className}>
      <span>{l.native}</span>
      {l.ru ? (
        <span lang="ru" className="block text-[0.85em] text-muted">
          {l.ru}
        </span>
      ) : null}
    </span>
  );
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (itemId: string, p: number) => `${itemId}:${p}`;

function isReviewed(item: ClientItem, fb: Record<string, ClientFeedback>): boolean {
  const whole = fb[key(item.id, -1)];
  if (whole && (whole.skipped || whole.comment || Object.keys(whole.ratings).length)) return true;
  return item.paragraphs.some((p, i) => {
    const f = fb[key(item.id, i)];
    return Boolean(f && (f.comment || (f.edited_text && norm(f.edited_text) !== norm(p.target))));
  });
}

export function ReviewApp({
  token,
  lang,
  items,
  initial,
  dict,
}: {
  token: string;
  lang: BookLang;
  items: ClientItem[];
  initial: Record<string, ClientFeedback>;
  dict: ReviewDictionary;
}) {
  const [fb, setFb] = useState<Record<string, ClientFeedback>>(initial);
  const firstOpen = useMemo(() => {
    const i = items.findIndex((it) => !isReviewed(it, initial));
    return i < 0 ? 0 : i;
  }, [items, initial]);
  const [index, setIndex] = useState(firstOpen);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [draftComment, setDraftComment] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const item = items[index];
  const reviewedCount = items.filter((it) => isReviewed(it, fb)).length;

  async function save(itemId: string, paragraph: number, next: ClientFeedback): Promise<boolean> {
    const k = key(itemId, paragraph);
    const prev = fb[k];
    setFb((s) => ({ ...s, [k]: next }));
    setStatus("saving");
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json", "x-review-token": token },
        body: JSON.stringify({ item_id: itemId, ...next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("saved");
      return true;
    } catch {
      setFb((s) => {
        const copy = { ...s };
        if (prev) copy[k] = prev;
        else delete copy[k];
        return copy;
      });
      setStatus("error");
      return false;
    }
  }

  const empty = (paragraph: number): ClientFeedback => ({ paragraph, edited_text: null, ratings: {}, comment: null, skipped: false });

  if (!item) {
    return <p className="rounded-card bg-paper-deep p-5 text-center"><Bi l={dict.empty} /></p>;
  }

  if (done) {
    return (
      <section className="flex flex-col items-center gap-4 rounded-card bg-paper-deep p-6 text-center shadow-card" data-testid="review-done">
        <Bi l={dict.doneText} className="font-serif text-xl" />
        <Bi l={dict.progress} className="text-ink-soft" />
        <p className="text-ink-soft" data-testid="review-progress">
          {reviewedCount} / {items.length}
        </p>
        <button type="button" className={`${btn} border border-line bg-paper`} onClick={() => setDone(false)}>
          <Bi l={dict.prev} />
        </button>
      </section>
    );
  }

  const whole = fb[key(item.id, -1)] ?? empty(-1);
  const go = (i: number) => {
    setEditing(null);
    setIndex(i);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur">
        <div className="h-2 flex-1 overflow-hidden rounded-button bg-paper-deep" aria-hidden>
          <div className="h-full bg-jade" style={{ width: `${Math.round((reviewedCount / items.length) * 100)}%` }} />
        </div>
        <span className="text-sm text-ink-soft" data-testid="review-progress">
          {dict.progress.native.replace("{n}", String(reviewedCount)).replace("{total}", String(items.length))}
        </span>
        <span className="min-w-16 text-right text-xs text-muted" aria-live="polite">
          {status === "saving" ? dict.saving.native : status === "saved" ? `✓ ${dict.saved.native}` : status === "error" ? dict.saveError.native : ""}
        </span>
      </div>

      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {index + 1} / {items.length}
        </p>
        {item.title ? (
          <h2 className="font-serif text-xl" lang={item.kind === "question" ? undefined : "ru"}>
            {item.kind === "question" ? `№ ${index + 1}` : item.title}
          </h2>
        ) : null}
      </header>

      {whole.skipped ? (
        <p className="rounded-card bg-paper-deep p-4 text-ink-soft">
          <Bi l={dict.skipped} />
        </p>
      ) : null}

      <ol className="flex flex-col gap-3">
        {item.paragraphs.map((p, i) => {
          const f = fb[key(item.id, i)];
          const edited = f?.edited_text && norm(f.edited_text) !== norm(p.target) ? f.edited_text : null;
          const isEditing = editing === i;
          return (
            <li key={i} className="grid gap-2 rounded-card border border-line bg-paper p-3 sm:grid-cols-2" data-paragraph={i}>
              <div lang="ru" className="text-ink-soft">
                <p className="mb-1 text-xs text-muted">{dict.source.native}</p>
                <p className="whitespace-pre-wrap">{p.source}</p>
              </div>
              <div lang={lang}>
                <p className="mb-1 text-xs text-muted">
                  {dict.target.native}
                  {edited ? <span className="ml-2 rounded-button bg-jade px-2 py-0.5 text-paper">{dict.edited.native}</span> : null}
                </p>
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      className="min-h-32 w-full rounded-card border border-ink bg-paper p-3 text-lg"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label={dict.edit.native}
                      autoFocus
                    />
                    <textarea
                      className="min-h-16 w-full rounded-card border border-line bg-paper p-3"
                      value={draftComment}
                      onChange={(e) => setDraftComment(e.target.value)}
                      placeholder={`${dict.commentPara.native} · ${dict.commentPara.ru}`}
                      aria-label={dict.commentPara.native}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`${btn} bg-seal text-paper`}
                        onClick={async () => {
                          const text = draft.trim();
                          const ok = await save(item.id, i, {
                            paragraph: i,
                            edited_text: text && norm(text) !== norm(p.target) ? text : null,
                            ratings: {},
                            comment: draftComment.trim() || null,
                            skipped: false,
                          });
                          if (ok) setEditing(null);
                        }}
                      >
                        <Bi l={dict.save} />
                      </button>
                      <button type="button" className={`${btn} border border-line bg-paper`} onClick={() => setEditing(null)}>
                        <Bi l={dict.cancel} />
                      </button>
                      {edited ? (
                        <button type="button" className={`${btn} border border-line bg-paper`} onClick={() => setDraft(p.target)}>
                          <Bi l={dict.restore} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full rounded-card p-1 text-left text-lg hover:bg-paper-deep focus:bg-paper-deep"
                    onClick={() => {
                      setEditing(i);
                      setDraft(edited ?? p.target);
                      setDraftComment(f?.comment ?? "");
                    }}
                    aria-label={`${dict.tapToEdit.native}: ${i + 1}`}
                  >
                    <span className="whitespace-pre-wrap">{edited ?? p.target}</span>
                    {f?.comment ? <span className="mt-1 block text-sm text-ink-soft">💬 {f.comment}</span> : null}
                    <span className="mt-1 block text-xs text-muted">✎ {dict.tapToEdit.native}</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <section className="flex flex-col gap-3 rounded-card bg-paper-deep p-4" aria-label={dict.rateWhole.native}>
        <Bi l={dict.rateWhole} className="font-serif text-lg" />
        <Bi l={dict.scale} className="text-sm text-ink-soft" />
        {AXES.map((axis) => (
          <fieldset key={axis} className="flex flex-col gap-1" data-axis={axis}>
            <legend className="text-sm">
              {dict.axes[axis].native}
              {dict.axes[axis].ru ? <span className="text-muted"> · {dict.axes[axis].ru}</span> : null}
            </legend>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => {
                const on = whole.ratings[axis] === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${dict.axes[axis].native} ${v}`}
                    className={`flex size-12 items-center justify-center rounded-button border text-lg ${on ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
                    onClick={() => {
                      const ratings = { ...whole.ratings };
                      if (on) delete ratings[axis];
                      else ratings[axis] = v;
                      void save(item.id, -1, { ...whole, ratings, skipped: false });
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <label className="flex flex-col gap-1">
          <Bi l={dict.comment} className="text-sm" />
          <textarea
            key={item.id}
            className="min-h-20 w-full rounded-card border border-line bg-paper p-3"
            defaultValue={whole.comment ?? ""}
            onBlur={(e) => {
              const c = e.target.value.trim() || null;
              if (c !== (whole.comment ?? null)) void save(item.id, -1, { ...whole, comment: c });
            }}
          />
        </label>
      </section>

      <div className="flex flex-wrap gap-2">
        {index > 0 ? (
          <button type="button" className={`${btn} border border-line bg-paper`} onClick={() => go(index - 1)}>
            ← <Bi l={dict.prev} className="ml-2" />
          </button>
        ) : null}
        <button
          type="button"
          className={`${btn} border border-line bg-paper`}
          onClick={async () => {
            await save(item.id, -1, { ...whole, skipped: !whole.skipped });
            if (!whole.skipped) {
              if (index + 1 < items.length) go(index + 1);
              else setDone(true);
            }
          }}
        >
          <Bi l={whole.skipped ? dict.unskip : dict.skip} />
        </button>
        {index + 1 < items.length ? (
          <button type="button" className={`${btn} ml-auto bg-seal text-paper`} onClick={() => go(index + 1)}>
            <Bi l={dict.next} className="mr-2" /> →
          </button>
        ) : (
          <button type="button" className={`${btn} ml-auto bg-seal text-paper`} onClick={() => setDone(true)}>
            <Bi l={dict.done} />
          </button>
        )}
      </div>
    </div>
  );
}
