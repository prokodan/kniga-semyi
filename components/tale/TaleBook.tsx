"use client";
// Страница-книжка сказки (I8): листание свайпом (scroll-snap), крупный текст, картинки догружаются параллельно.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TALE_MIN_STORIES, type TalePageView, type TaleView } from "@/lib/tale/types";

type Props = { token: string; initial: TaleView };

const btn = "button flex items-center justify-center rounded-button px-6 py-4 text-elder font-semibold";
const primary = `${btn} bg-seal text-paper active:bg-seal-dark disabled:opacity-60`;
const secondary = "button flex items-center justify-center rounded-button border border-line px-5 py-3 text-ink disabled:opacity-60";

class CallError extends Error {
  constructor(
    message: string,
    /** сервер не ответил по делу: сеть, 5xx без JSON (функция упала по лимиту времени) */
    readonly lost: boolean,
  ) {
    super(message);
  }
}

async function call<T>(token: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/extras/tale", {
      method: "POST",
      headers: { "content-type": "application/json", "x-family-token": token },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CallError("Нет связи с сервером — проверьте интернет и нажмите «Попробовать ещё раз».", true);
  }
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok || !data) {
    if (data?.message) throw new CallError(data.message, false);
    throw new CallError("Сервер не успел ответить — нажмите «Попробовать ещё раз».", true);
  }
  return data;
}

type Illustrated = { page: number; image: string; fallback: boolean; notice: string | null };

export function TaleBook({ token, initial }: Props) {
  const [tale, setTale] = useState<TaleView>(initial);
  const [childName, setChildName] = useState(initial.childName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** страницы, которые рисуются сейчас */
  const [drawing, setDrawing] = useState<Set<number>>(new Set());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [current, setCurrent] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const requested = useRef<Set<number>>(new Set());

  const setPage = (i: number, patch: Partial<TalePageView>) =>
    setTale((t) => {
      const pages = t.pages.map((p, j) => (j === i ? { ...p, ...patch } : p));
      return { ...t, pages, illustrated: pages.filter((p) => p.image).length };
    });

  const draw = useCallback(
    async (i: number, regenerate = false) => {
      setDrawing((s) => new Set(s).add(i));
      setPage(i, { imageError: null });
      try {
        let r: Illustrated;
        try {
          r = await call<Illustrated>(token, { action: "illustrate", page: i, regenerate });
        } catch (e) {
          // Не дождались ответа (лимит времени функции) — сразу картинка из набора, без пустого места.
          if (!(e instanceof CallError) || !e.lost) throw e;
          r = await call<Illustrated>(token, { action: "illustrate", page: i, fallback: true });
        }
        setPage(i, { image: r.image, fallback: r.fallback, imageError: r.notice });
      } catch (e) {
        setPage(i, { imageError: e instanceof Error ? e.message : "Картинка не получилась" });
      } finally {
        setDrawing((s) => {
          const n = new Set(s);
          n.delete(i);
          return n;
        });
      }
    },
    [token],
  );

  // Готовый текст → все недостающие картинки параллельно (по запросу на страницу).
  useEffect(() => {
    if (tale.status !== "ready") return;
    const missing = tale.pages.map((p, i) => (!p.image && !requested.current.has(i) ? i : -1)).filter((i) => i >= 0);
    if (missing.length === 0) return;
    setStartedAt((s) => s ?? Date.now());
    for (const i of missing) {
      requested.current.add(i);
      void draw(i);
    }
  }, [tale, draw]);

  // Кто-то другой пишет сказку (второе устройство) — подтягиваем статус.
  useEffect(() => {
    if (tale.status !== "writing" || busy) return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/extras/tale?token=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok) setTale((await res.json()) as TaleView);
    }, 3000);
    return () => clearInterval(id);
  }, [tale.status, busy, token]);

  const working = busy || drawing.size > 0;
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [working]);

  async function write(again = false) {
    setBusy(true);
    setError(null);
    setStartedAt(Date.now());
    requested.current = new Set();
    setTale((t) => ({ ...t, status: "writing", pages: [], illustrated: 0 }));
    try {
      const view = await call<TaleView>(token, { action: "write", childName, again });
      setTale(view);
      setCurrent(0);
      scroller.current?.scrollTo({ left: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Сказка не получилась");
      // Сервер вернул прежнюю сказку (если была) или отметил «не получилось» — показываем как есть.
      const res = await fetch(`/api/extras/tale?token=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      const view = res?.ok ? ((await res.json().catch(() => null)) as TaleView | null) : null;
      setTale((t) => view ?? { ...t, status: "failed" });
    } finally {
      setBusy(false);
    }
  }

  function go(i: number) {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const notEnough = tale.storiesReady < TALE_MIN_STORIES;

  // ---------- ещё нет сказки / пишется / не вышло ----------
  if (tale.status !== "ready") {
    const writing = tale.status === "writing";
    return (
      <section className="flex flex-col gap-4 rounded-card bg-paper-deep p-5 shadow-card">
        <p className="text-ink-soft">
          Добрая сказка для детей 5–10 лет по настоящим рассказам{tale.storytellerName ? ` — ${tale.storytellerName}` : ""}: 4 страницы и 4 картинки в одном
          стиле, акварелью.
        </p>
        {writing ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="font-serif text-2xl">Сказка пишется…</p>
            <p className="text-muted">Это займёт около минуты{elapsed ? ` · ${elapsed} с` : ""}. Потом нарисуем картинки.</p>
            <div className="h-2 overflow-hidden rounded-button bg-line">
              <div className="h-full w-1/3 animate-pulse rounded-button bg-seal" />
            </div>
          </div>
        ) : notEnough ? (
          <>
            <p className="text-elder">
              Для сказки нужно хотя бы {TALE_MIN_STORIES} готовые главы, сейчас — {tale.storiesReady}.
            </p>
            <Link href={`/f/${token}`} className={primary}>
              Записать ещё историю
            </Link>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-2">
              <span className="text-ink-soft">Для кого сказка? Имя внука или внучки (можно пропустить)</span>
              <input
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                maxLength={40}
                placeholder="Например, Алиса"
                className="min-h-12 rounded-button border border-line bg-paper px-5 text-elder text-ink"
              />
            </label>
            <button type="button" onClick={() => void write(tale.status === "failed" || Boolean(error))} disabled={busy} className={primary}>
              {tale.status === "failed" || error ? "Попробовать ещё раз" : "Написать сказку"}
            </button>
          </>
        )}
        {(error ?? tale.error) && !writing ? <p className="text-danger">{error ?? tale.error}</p> : null}
      </section>
    );
  }

  // ---------- книжка ----------
  const total = tale.pages.length + 1; // обложка + страницы
  return (
    <section className="flex flex-col gap-4">
      {tale.illustrated < tale.pages.length ? (
        <div className="flex flex-col gap-2 rounded-card bg-paper-deep p-4" aria-live="polite">
          <p className="text-ink-soft">
            Рисуем картинки: {tale.illustrated} из {tale.pages.length}
            {working && elapsed ? ` · ${elapsed} с` : ""}
          </p>
          <div className="h-2 overflow-hidden rounded-button bg-line">
            <div className="h-full rounded-button bg-jade transition-all" style={{ width: `${(tale.illustrated / Math.max(tale.pages.length, 1)) * 100}%` }} />
          </div>
        </div>
      ) : null}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setCurrent(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-card bg-paper shadow-card [scrollbar-width:none]"
      >
        <article className="flex w-full shrink-0 snap-center flex-col items-center justify-center gap-4 px-6 py-12 text-center">
          <p className="text-sm tracking-widest text-muted uppercase">Сказка · 동화</p>
          <h2 className="font-serif text-4xl leading-tight text-ink">{tale.title}</h2>
          {tale.storytellerName ? <p className="text-elder text-ink-soft">по рассказам — {tale.storytellerName}</p> : null}
          {tale.childName ? <p className="text-elder text-seal">для {tale.childName}</p> : null}
          <p className="text-muted">Листайте вправо →</p>
        </article>

        {tale.pages.map((p, i) => (
          <article key={i} className="flex w-full shrink-0 snap-center flex-col gap-4 p-4">
            <div className="relative aspect-square w-full overflow-hidden rounded-card bg-paper-deep">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- подписанные ссылки Storage и data:-заглушки
                <img src={p.image} alt={`Картинка к странице ${i + 1}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
                  {p.imageError ? <span className="text-danger">{p.imageError}</span> : <span className="animate-pulse">Рисуем картинку…</span>}
                </div>
              )}
            </div>
            {p.image && p.imageError ? <p className="text-sm text-muted">{p.imageError}</p> : null}
            <p className="font-serif text-2xl leading-relaxed text-ink">{p.text}</p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">
                {i + 1} / {tale.pages.length}
              </span>
              <button type="button" onClick={() => void draw(i, true)} disabled={drawing.has(i)} className={secondary}>
                {drawing.has(i) ? "Рисуем…" : p.fallback ? "Нарисовать свою" : p.image ? "Перерисовать" : "Нарисовать"}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => go(current - 1)} disabled={current <= 0} className={secondary} aria-label="Предыдущая страница">
          ←
        </button>
        <div className="flex gap-2" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-button ${i === current ? "bg-seal" : "bg-line"}`} />
          ))}
        </div>
        <button type="button" onClick={() => go(current + 1)} disabled={current >= total - 1} className={secondary} aria-label="Следующая страница">
          →
        </button>
      </div>

      {error ? (
        <div role="alert" className="flex flex-col gap-3 rounded-card border border-danger/40 bg-paper p-4">
          <p className="text-danger">{error}</p>
          <button type="button" onClick={() => void write(true)} disabled={working} className={primary}>
            Попробовать ещё раз
          </button>
        </div>
      ) : null}
      <button type="button" onClick={() => void write(true)} disabled={working} className={secondary}>
        Написать сказку заново
      </button>
    </section>
  );
}
