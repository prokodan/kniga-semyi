"use client";
// #353 (QUALITY_LOOP.md §4): /review 2.0 — экран входа «что от вас нужно», режимы «текст» и «слова», «Не знаю —
// пропустить», автосохранение (каждое действие → POST /api/review/check; черновик правки — ещё и в браузере),
// прогресс «N из M», итог. Токен — в заголовке x-review-token, не в адресе API.
import { useEffect, useMemo, useRef, useState } from "react";
import type { BookLang, ReviewAxis, ReviewRatings } from "@/lib/types";
import {
  estimateMinutes,
  highlightSegments,
  itemState,
  progressCount,
  wordDiff,
  type CheckKind,
  type FocusTerm,
  type ItemState,
  type TermVerdicts,
  type UiLang,
} from "@/app/admin/quality/checks/_lib/core";
import type { CheckDictionary, L } from "../_lib/checks-strings";

export interface CheckClientItem {
  id: string;
  title: string | null;
  paragraphs: { source: string; target: string }[];
  focusTerms: FocusTerm[];
}

export interface CheckClientFeedback {
  paragraph: number;
  edited_text: string | null;
  ratings: ReviewRatings;
  comment: string | null;
  skipped: boolean;
  terms: TermVerdicts;
}

const btn = "flex min-h-12 items-center justify-center rounded-button px-5 text-base";
const ghost = `${btn} border border-line bg-paper active:bg-paper-deep`;
const primary = `${btn} bg-seal text-paper active:bg-seal-dark`;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (itemId: string, p: number) => `${itemId}:${p}`;
const empty = (paragraph: number): CheckClientFeedback => ({ paragraph, edited_text: null, ratings: {}, comment: null, skipped: false, terms: {} });

function Bi({ l, className = "", ruClass = "" }: { l: L; className?: string; ruClass?: string }) {
  return (
    <span className={className}>
      <span>{l.native}</span>
      {l.ru ? (
        <span lang="ru" className={`block text-[0.85em] text-muted ${ruClass}`}>
          {l.ru}
        </span>
      ) : null}
    </span>
  );
}

const fill = (l: L, vars: Record<string, string | number>): L => {
  const f = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
  return { native: f(l.native), ru: f(l.ru) };
};

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <span className="whitespace-pre-wrap" data-testid="para-diff">
      {wordDiff(before, after).map((d, i) =>
        d.op === "same" ? (
          <span key={i}>{d.text}</span>
        ) : d.op === "del" ? (
          <del key={i} className="text-danger line-through decoration-2">
            {d.text}
          </del>
        ) : (
          <ins key={i} className="rounded-sm bg-jade/20 text-ink no-underline">
            {d.text}
          </ins>
        ),
      )}
    </span>
  );
}

function Marked({ text, terms, lang }: { text: string; terms: FocusTerm[]; lang: BookLang }) {
  return (
    <span lang={lang} className="whitespace-pre-wrap">
      {highlightSegments(text, terms).map((s, i) =>
        s.term === null ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark key={i} className="rounded-sm bg-gold/25 px-0.5 text-ink" data-term-mark={s.term}>
            {s.text}
            <sup className="ml-0.5 text-xs text-gold">{s.term + 1}</sup>
          </mark>
        ),
      )}
    </span>
  );
}

function draftGet(k: string): string | null {
  try {
    return window.localStorage.getItem(`rv2:${k}`);
  } catch {
    return null;
  }
}
function draftSet(k: string, v: string | null) {
  try {
    if (v === null) window.localStorage.removeItem(`rv2:${k}`);
    else window.localStorage.setItem(`rv2:${k}`, v);
  } catch {
    /* приватный режим Safari — без черновика в браузере */
  }
}

export function CheckApp({
  token,
  kind,
  uiLang,
  target,
  items,
  criteria,
  initial,
  completed,
  dict,
}: {
  token: string;
  kind: CheckKind;
  uiLang: UiLang;
  target: BookLang;
  items: CheckClientItem[];
  criteria: ReviewAxis[];
  initial: Record<string, CheckClientFeedback>;
  completed: boolean;
  dict: CheckDictionary;
}) {
  const s = dict.strings;
  const [fb, setFb] = useState<Record<string, CheckClientFeedback>>(initial);
  const [screen, setScreen] = useState<"intro" | "item" | "done">("intro");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [draftComment, setDraftComment] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [done, setDone] = useState(completed);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const flat = useMemo(() => Object.entries(fb).map(([k, f]) => ({ ...f, item_id: k.slice(0, k.lastIndexOf(":")) })), [fb]);
  const states: ItemState[] = items.map((it) =>
    itemState(kind, { id: it.id, targets: it.paragraphs.map((p) => p.target), termCount: it.focusTerms.length }, flat, criteria),
  );
  const prog = progressCount(states);
  const open = states.findIndex((st) => st === "empty" || st === "partial");
  const firstOpen = open < 0 ? 0 : open;
  const [index, setIndex] = useState(firstOpen);
  const item = items[index];

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach((x) => clearTimeout(x));
  }, []);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setStatus("saving");
    try {
      const res = await fetch("/api/review/check", {
        method: "POST",
        headers: { "content-type": "application/json", "x-review-token": token },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("saved");
      return true;
    } catch {
      setStatus("error");
      return false;
    }
  }

  async function save(itemId: string, paragraph: number, next: CheckClientFeedback): Promise<boolean> {
    const k = key(itemId, paragraph);
    const prev = fb[k];
    setFb((x) => ({ ...x, [k]: next }));
    const ok = await post({ item_id: itemId, ...next, terms: paragraph === -1 ? next.terms : undefined });
    if (!ok)
      setFb((x) => {
        const copy = { ...x };
        if (prev) copy[k] = prev;
        else delete copy[k];
        return copy;
      });
    return ok;
  }

  /** Сохранить с задержкой (комментарий, «как правильно») — пока человек печатает. */
  function saveLater(id: string, run: () => void, ms = 900) {
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(run, ms);
  }

  const go = (i: number) => {
    setEditing(null);
    setIndex(i);
    setScreen("item");
    window.scrollTo({ top: 0 });
  };

  const finish = async () => {
    setScreen("done");
    window.scrollTo({ top: 0 });
    if (!done && (await post({ action: "complete" }))) setDone(true);
  };

  const [estLo, estHi] = estimateMinutes(kind, items.length);

  const bar = (
    <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur">
      <div className="h-2 flex-1 overflow-hidden rounded-button bg-paper-deep" aria-hidden>
        <div className="h-full bg-jade transition-all" style={{ width: `${items.length ? Math.round((prog.done / items.length) * 100) : 0}%` }} />
      </div>
      <span className="text-sm whitespace-nowrap text-ink-soft" data-testid="review2-progress">
        {fill(s.progress, { n: prog.done, total: prog.total }).native}
      </span>
      <span className="min-w-14 text-right text-xs text-muted" aria-live="polite" data-testid="review2-status">
        {status === "saving" ? s.saving.native : status === "saved" ? `✓ ${s.saved.native}` : status === "error" ? s.saveError.native : ""}
      </span>
    </div>
  );

  if (!items.length) {
    return (
      <p className="rounded-card bg-paper-deep p-5 text-center">
        <Bi l={s.empty} />
      </p>
    );
  }

  // ---------------- вход ----------------
  if (screen === "intro") {
    const ex = dict.example;
    const need = kind === "text" ? [s.needText1, s.needText2, s.needText3] : [s.needTerms1, s.needTerms2, s.needTerms3];
    const started = prog.done > 0 || states.some((x) => x === "partial");
    return (
      <div className="flex flex-col gap-4" data-testid="review2-intro" data-kind={kind}>
        <Bi l={s.hello} className="font-serif text-xl" />
        <section className="flex flex-col gap-3 rounded-card bg-paper-deep p-4">
          <h2 className="font-serif text-lg">
            <Bi l={s.needTitle} />
          </h2>
          <ol className="flex flex-col gap-3">
            {need.map((l, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-button bg-seal text-paper">{i + 1}</span>
                <Bi l={l} />
              </li>
            ))}
          </ol>
          <p className="flex gap-2 border-t border-line pt-3 text-ink-soft">
            <span aria-hidden>⏱</span>
            <Bi l={fill(s.time, { a: estLo, b: estHi, n: items.length })} />
          </p>
          <p className="text-sm text-ink-soft">
            <Bi l={s.pause} />
          </p>
        </section>

        <section className="flex flex-col gap-2 rounded-card border border-line bg-paper p-4" data-testid="review2-example">
          <h2 className="font-serif text-lg">
            <Bi l={s.exampleTitle} />
          </h2>
          <p lang="ru" className="text-sm text-ink-soft">
            {ex.source}
          </p>
          {kind === "text" ? (
            <>
              <p lang={target} className="text-lg">
                <Diff before={ex.model} after={ex.fixed} />
              </p>
              <p className="flex flex-wrap gap-1 text-xs">
                {criteria.map((c) =>
                  ex.ratings[c] ? (
                    <span key={c} className="rounded-button bg-paper-deep px-2 py-1">
                      {dict.crit[c].label.native} {ex.ratings[c]}
                    </span>
                  ) : null,
                )}
              </p>
            </>
          ) : (
            <>
              <p className="text-lg">
                <Marked text={ex.model} terms={[{ term: ex.term.term }]} lang={target} />
              </p>
              <p className="text-sm">
                <span className="font-medium">1. {ex.term.term}</span> — <span className="text-danger">✗ {s.wrong.native}</span> →{" "}
                <b lang={target}>{ex.term.fix}</b>
              </p>
            </>
          )}
          <p className="text-sm">
            💬 <Bi l={ex.why} className="inline" ruClass="inline before:content-['_·_']" />
          </p>
        </section>

        <p className="text-sm text-muted">
          <Bi l={s.fiction} />
        </p>
        <button type="button" className={`${primary} w-full`} onClick={() => go(firstOpen)} data-testid="review2-start">
          <Bi l={started ? fill(s.resume, { n: prog.done, total: prog.total }) : s.start} />
        </button>
      </div>
    );
  }

  // ---------------- итог ----------------
  if (screen === "done" || !item) {
    const edits = Object.entries(fb).filter(([k, f]) => {
      if (f.paragraph < 0 || !f.edited_text) return false;
      const it = items.find((x) => x.id === k.slice(0, k.lastIndexOf(":")));
      return it ? norm(f.edited_text) !== norm(it.paragraphs[f.paragraph]?.target ?? "") : false;
    }).length;
    const wrong = Object.values(fb).reduce((n, f) => n + Object.values(f.terms ?? {}).filter((v) => v?.ok === false).length, 0);
    const skipped = states.filter((x) => x === "skipped").length;
    return (
      <div className="flex flex-col gap-4">
        {bar}
        <section className="flex flex-col items-center gap-3 rounded-card bg-paper-deep p-6 text-center shadow-card" data-testid="review2-done">
          <span className="text-4xl" aria-hidden>
            🙏
          </span>
          <Bi l={s.doneTitle} className="font-serif text-2xl" />
          <Bi l={s.doneText} className="text-ink-soft" />
          <ul className="flex flex-col gap-1 text-ink-soft">
            <li>
              <Bi l={fill(s.sumChecked, { n: prog.done, total: prog.total })} />
            </li>
            {kind === "text" ? (
              <li>
                <Bi l={fill(s.sumEdits, { n: edits })} />
              </li>
            ) : (
              <li>
                <Bi l={fill(s.sumWrong, { n: wrong })} />
              </li>
            )}
            {skipped ? (
              <li>
                <Bi l={fill(s.sumSkipped, { n: skipped })} />
              </li>
            ) : null}
          </ul>
          <button type="button" className={ghost} onClick={() => go(0)}>
            <Bi l={s.back} />
          </button>
        </section>
      </div>
    );
  }

  // ---------------- текст ----------------
  const whole = fb[key(item.id, -1)] ?? empty(-1);
  const last = index + 1 >= items.length;

  const commentBox = (
    <label className="flex flex-col gap-1">
      <Bi l={s.comment} className="text-sm" />
      <textarea
        key={`c-${item.id}`}
        className="min-h-20 w-full rounded-card border border-line bg-paper p-3 text-base"
        defaultValue={whole.comment ?? ""}
        data-testid="review2-comment"
        onChange={(e) => {
          const c = e.target.value.trim() || null;
          saveLater(`c-${item.id}`, () => void save(item.id, -1, { ...(fb[key(item.id, -1)] ?? empty(-1)), comment: c }));
        }}
        onBlur={(e) => {
          const c = e.target.value.trim() || null;
          clearTimeout(timers.current[`c-${item.id}`]);
          if (c !== (whole.comment ?? null)) void save(item.id, -1, { ...whole, comment: c });
        }}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="review2-item" data-kind={kind} data-index={index}>
      {bar}
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">{fill(s.itemOf, { i: index + 1, total: items.length }).native}</p>
        {item.title ? (
          <h2 className="font-serif text-xl" lang="ru">
            {item.title}
          </h2>
        ) : null}
      </header>

      {whole.skipped ? (
        <p className="rounded-card bg-paper-deep p-4 text-ink-soft" data-testid="review2-skipped">
          <Bi l={s.skipped} />
        </p>
      ) : null}

      {kind === "text" ? (
        <ol className="flex flex-col gap-3">
          {item.paragraphs.map((p, i) => {
            const k = key(item.id, i);
            const f = fb[k];
            const edited = f?.edited_text && norm(f.edited_text) !== norm(p.target) ? f.edited_text : null;
            const isEditing = editing === i;
            return (
              <li key={i} className="flex flex-col gap-2 rounded-card border border-line bg-paper p-3" data-paragraph={i}>
                <div lang="ru" className="text-ink-soft">
                  <p className="mb-1 text-xs text-muted">{s.source.native}</p>
                  <p className="whitespace-pre-wrap">{p.source}</p>
                </div>
                <div lang={target} className="border-t border-line pt-2">
                  <p className="mb-1 flex items-center gap-2 text-xs text-muted">
                    {s.target.native}
                    {edited ? <span className="rounded-button bg-jade px-2 py-0.5 text-paper">{s.edited.native}</span> : null}
                  </p>
                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        className="min-h-36 w-full rounded-card border border-ink bg-paper p-3 text-lg"
                        value={draft}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          draftSet(k, e.target.value);
                        }}
                        aria-label={s.tapToEdit.native}
                        data-testid="para-text"
                        autoFocus
                      />
                      {norm(draft) !== norm(p.target) ? (
                        <p className="rounded-card bg-paper-deep p-2 text-base">
                          <span className="mb-1 block text-xs text-muted">{s.yourEdit.native}</span>
                          <Diff before={p.target} after={draft} />
                        </p>
                      ) : null}
                      <textarea
                        className="min-h-16 w-full rounded-card border border-line bg-paper p-3 text-base"
                        value={draftComment}
                        onChange={(e) => setDraftComment(e.target.value)}
                        placeholder={s.commentPara.native}
                        aria-label={s.commentPara.native}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={primary}
                          data-testid="para-save"
                          onClick={async () => {
                            const text = draft.trim();
                            const ok = await save(item.id, i, {
                              ...empty(i),
                              edited_text: text && norm(text) !== norm(p.target) ? text : null,
                              comment: draftComment.trim() || null,
                            });
                            if (ok) {
                              draftSet(k, null);
                              setEditing(null);
                            }
                          }}
                        >
                          <Bi l={s.save} />
                        </button>
                        <button type="button" className={ghost} onClick={() => setEditing(null)}>
                          <Bi l={s.cancel} />
                        </button>
                        {norm(draft) !== norm(p.target) ? (
                          <button type="button" className={ghost} onClick={() => setDraft(p.target)}>
                            <Bi l={s.restore} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full rounded-card p-1 text-left text-lg active:bg-paper-deep"
                      data-testid={`para-edit-${i}`}
                      onClick={() => {
                        setEditing(i);
                        setDraft(draftGet(k) ?? edited ?? p.target);
                        setDraftComment(f?.comment ?? "");
                      }}
                    >
                      {edited ? <Diff before={p.target} after={edited} /> : <span className="whitespace-pre-wrap">{p.target}</span>}
                      {f?.comment ? <span className="mt-1 block text-sm text-ink-soft">💬 {f.comment}</span> : null}
                      <span className="mt-1 block text-xs text-muted">✎ {s.tapToEdit.native}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <>
          <section className="flex flex-col gap-2 rounded-card border border-line bg-paper p-3">
            <p className="text-xs text-muted">{s.target.native}</p>
            {item.paragraphs.map((p, i) => (
              <p key={i} className="text-lg">
                <Marked text={p.target} terms={item.focusTerms} lang={target} />
              </p>
            ))}
            <details className="border-t border-line pt-2 text-ink-soft">
              <summary className="min-h-12 cursor-pointer py-3 text-sm">{s.showSource.native}</summary>
              {item.paragraphs.map((p, i) => (
                <p key={i} lang="ru" className="mb-2 whitespace-pre-wrap">
                  {p.source}
                </p>
              ))}
            </details>
          </section>
          <section className="flex flex-col gap-3 rounded-card bg-paper-deep p-4" aria-label={s.termsTitle.native}>
            <Bi l={s.termsTitle} className="font-serif text-lg" />
            <Bi l={s.termsHint} className="text-sm text-ink-soft" />
            <ol className="flex flex-col gap-3">
              {item.focusTerms.map((t, ti) => {
                const v = whole.terms[String(ti)];
                const setTerm = (next: { ok: boolean | null; fix?: string | null }) => {
                  const cur = fb[key(item.id, -1)] ?? empty(-1);
                  void save(item.id, -1, { ...cur, skipped: false, terms: { ...cur.terms, [String(ti)]: next } });
                };
                return (
                  <li key={ti} className="flex flex-col gap-2 rounded-card bg-paper p-3" data-term={ti}>
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm text-gold">{ti + 1}.</span>
                      <b lang={target} className="text-lg">
                        {t.term}
                      </b>
                      {t.hint ? (
                        <span lang="ru" className="text-sm text-muted">
                          ≈ {t.hint}
                        </span>
                      ) : null}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={v?.ok === true}
                        data-testid={`term-ok-${ti}`}
                        className={`${btn} border ${v?.ok === true ? "border-success bg-success text-paper" : "border-line bg-paper"}`}
                        onClick={() => setTerm({ ok: v?.ok === true ? null : true })}
                      >
                        ✓ {s.right.native}
                      </button>
                      <button
                        type="button"
                        aria-pressed={v?.ok === false}
                        data-testid={`term-bad-${ti}`}
                        className={`${btn} border ${v?.ok === false ? "border-danger bg-danger text-paper" : "border-line bg-paper"}`}
                        onClick={() => setTerm({ ok: v?.ok === false ? null : false, fix: v?.fix ?? null })}
                      >
                        ✗ {s.wrong.native}
                      </button>
                    </div>
                    {v?.ok === false ? (
                      <label className="flex flex-col gap-1 text-sm">
                        <Bi l={s.howRight} />
                        <input
                          key={`f-${item.id}-${ti}`}
                          lang={target}
                          className="min-h-12 w-full rounded-card border border-line bg-paper px-3 text-lg"
                          defaultValue={v.fix ?? ""}
                          data-testid={`term-fix-${ti}`}
                          maxLength={200}
                          onChange={(e) => {
                            const fix = e.target.value;
                            saveLater(`f-${item.id}-${ti}`, () => setTerm({ ok: false, fix }));
                          }}
                          onBlur={(e) => {
                            clearTimeout(timers.current[`f-${item.id}-${ti}`]);
                            if ((v.fix ?? "") !== e.target.value.trim()) setTerm({ ok: false, fix: e.target.value });
                          }}
                        />
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}

      {kind === "text" ? (
        <section className="flex flex-col gap-4 rounded-card bg-paper-deep p-4" aria-label={s.criteriaTitle.native}>
          <div>
            <Bi l={s.criteriaTitle} className="font-serif text-lg" />
            <Bi l={s.criteriaHint} className="text-sm text-ink-soft" />
          </div>
          {criteria.map((axis) => {
            const c = dict.crit[axis];
            return (
              <fieldset key={axis} className="flex flex-col gap-1" data-axis={axis}>
                <legend className="mb-1 font-medium">
                  {c.label.native}
                  {c.label.ru ? <span className="font-normal text-muted"> · {c.label.ru}</span> : null}
                </legend>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((v) => {
                    const on = whole.ratings[axis] === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${c.label.native} ${v}`}
                        className={`flex min-h-12 items-center justify-center rounded-button border text-lg ${on ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
                        onClick={() => {
                          const cur = fb[key(item.id, -1)] ?? empty(-1);
                          const ratings = { ...cur.ratings };
                          if (on) delete ratings[axis];
                          else ratings[axis] = v;
                          void save(item.id, -1, { ...cur, ratings, skipped: false });
                        }}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs leading-snug text-ink-soft">
                  <Bi l={c.a1} className="text-left" />
                  <Bi l={c.a3} className="text-center" />
                  <Bi l={c.a5} className="text-right" />
                </div>
              </fieldset>
            );
          })}
          {commentBox}
        </section>
      ) : (
        <section className="rounded-card bg-paper-deep p-4">{commentBox}</section>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={`${ghost} w-full`}
          data-testid="review2-skip"
          onClick={async () => {
            const cur = fb[key(item.id, -1)] ?? empty(-1);
            const ok = await save(item.id, -1, { ...cur, skipped: !cur.skipped });
            if (ok && !cur.skipped) {
              if (last) void finish();
              else go(index + 1);
            }
          }}
        >
          <Bi l={whole.skipped ? s.unskip : s.skip} />
        </button>
        <div className="flex gap-2">
          {index > 0 ? (
            <button type="button" className={`${ghost} flex-1`} onClick={() => go(index - 1)}>
              ← {s.prev.native}
            </button>
          ) : (
            <button type="button" className={`${ghost} flex-1`} onClick={() => setScreen("intro")}>
              ← {s.prev.native}
            </button>
          )}
          {last ? (
            <button type="button" className={`${primary} flex-1`} onClick={() => void finish()} data-testid="review2-finish">
              {s.finish.native}
            </button>
          ) : (
            <button type="button" className={`${primary} flex-1`} onClick={() => go(index + 1)} data-testid="review2-next">
              {s.next.native} →
            </button>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-muted" lang={uiLang}>
        {s.pause.native}
      </p>
    </div>
  );
}
