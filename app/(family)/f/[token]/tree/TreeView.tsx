"use client";
// #235 → #277 древо 2.0 на телефоне. Окно древа: один палец — перетаскивание, два — щипок, кнопки − / + / ⌖ / ⤢;
// страница вбок не листается. Линии и капсулы пар — SVG, люди — кнопки поверх (≥ 48 px, читаются диктором).
// Подписи рядов прилипают к левому краю окна. Вид «Списком» — те же поколения строками.
// Тап по человеку → лист снизу: фото (#269), главы, книга / «Записать историю мамы», исправить, «это тот же человек».
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PLACE_ROLES, type PlaceRole } from "@/lib/tree/edit";
import { CARD, type TreeModel, type TreeNode } from "@/lib/tree/layout";
import { rowTitle, type RowLang } from "@/lib/tree/rows";
import { treeAction, treePhotoAction, type TreeOp, type TreeOpResult } from "./actions";

const field = "w-full rounded-card border border-line bg-paper px-4 py-3 text-lg text-ink placeholder:text-muted focus:border-ink focus:outline-none";
const primary = "min-h-12 rounded-button bg-seal px-6 py-3 text-lg font-semibold text-paper active:bg-seal-dark disabled:opacity-50";
const secondary = "min-h-12 rounded-button border border-line bg-paper px-4 py-3 text-lg text-ink disabled:opacity-50";
const linkRow = "flex min-h-12 items-center justify-between gap-3 rounded-card px-4 py-3";
const round = "flex size-12 items-center justify-center rounded-button border border-line bg-paper text-2xl text-ink active:bg-paper-deep";
const tool = "inline-flex min-h-12 items-center gap-2 rounded-button border border-line bg-paper px-4 text-base text-ink active:bg-paper-deep";

type Mode = "view" | "edit" | "merge" | "place";
type Xform = { x: number; y: number; s: number };
type Box = { x: number; y: number; w: number; h: number };

const MAX_SCALE = 1.6;
const TAP_SLOP = 6;
const ANIM_MS = 260;

interface Props {
  token: string;
  familyName: string;
  model: TreeModel;
  photos: Record<string, string>;
  showKo: boolean;
  rowLang: RowLang;
  storytellers: { id: string; name: string }[];
  chapterTitles: Record<string, string>;
  /** ?book=… (если смотрим не первого рассказчика) — сохраняем в ссылках «+ ещё» */
  book: string | null;
  opened: string[] | "all";
  /** После «+ ещё N» — поставить этого человека в центр */
  focusId: string | null;
}

function recordHref(token: string, familyName: string, n: TreeNode): string {
  const q = new URLSearchParams({ from: token, book: familyName });
  if (n.realName) q.set("storyteller", n.realName);
  if (n.birthYear) q.set("birthYear", String(n.birthYear));
  if (n.nameKo && !n.kinOnly) q.set("nameKo", n.nameKo);
  return `/start?${q.toString()}`;
}

function recordLabel(n: TreeNode): string {
  if (n.label && !n.isViewer && n.label.gen !== "родни") return `Записать историю ${n.label.gen}`;
  return `Записать историю: ${n.name}`;
}

const initial = (s: string) => (s.trim()[0] ?? "·").toUpperCase();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function treeHref(token: string, book: string | null, open: string[] | "all", focus?: string) {
  const q = new URLSearchParams();
  if (book) q.set("book", book);
  if (open === "all" || open.length) q.set("open", open === "all" ? "all" : open.join(","));
  if (focus) q.set("focus", focus);
  const s = q.toString();
  return `/f/${token}/tree${s ? `?${s}` : ""}`;
}

/** Фото для древа: центр-квадрат 512 × 512 JPEG (iPhone отдаёт HEIC по 3–5 МБ; круг — обрезка в CSS). */
async function squarePhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(512, side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    canvas.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob) throw new Error("toBlob");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Avatar({ n, photo, size }: { n: TreeNode; photo?: string; size: "card" | "list" | "sheet" }) {
  const cls = size === "card" ? "size-10 text-lg" : size === "list" ? "size-12 text-xl" : "size-18 text-3xl";
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка Storage, next/image не нужен
    return <img src={photo} alt="" className={`${cls} shrink-0 rounded-full object-cover`} draggable={false} />;
  }
  return (
    <span aria-hidden className={`flex ${cls} shrink-0 items-center justify-center rounded-full font-serif ${n.isViewer ? "bg-seal text-paper" : "bg-paper-deep text-seal"}`}>
      {initial(n.name)}
    </span>
  );
}

const ariaName = (n: TreeNode) => [n.name, n.label?.ru, n.years].filter(Boolean).join(", ");

export function TreeView({ token, familyName, model, photos, showKo, rowLang, storytellers, chapterTitles, book, opened, focusId }: Props) {
  const router = useRouter();
  const [view, setView] = useState<"tree" | "list">("tree");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [notice, setNotice] = useState<TreeOpResult | null>(null);
  const [busy, setBusy] = useState(false);
  const everyone = useMemo(() => [...model.nodes, ...model.hidden, ...model.others], [model]);
  const node = everyone.find((n) => n.id === selected) ?? null;

  const done = (r: TreeOpResult) => {
    setBusy(false);
    setNotice(r);
    if (r.ok) {
      setMode("view");
      setSelected(null);
      router.refresh();
    }
    return r.ok;
  };

  const run = async (op: TreeOp) => {
    setBusy(true);
    try {
      return done(await treeAction(token, op));
    } catch {
      return done({ ok: false, message: "Нет связи. Проверьте интернет и попробуйте ещё раз." });
    }
  };

  const photo = async (id: string, file: File | null) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("id", id);
      if (file) {
        let blob: Blob;
        try {
          blob = await squarePhoto(file);
        } catch {
          return done({ ok: false, message: "Это фото не открылось. Выберите другое (JPEG или PNG)." });
        }
        fd.set("photo", blob, "photo.jpg");
      } else fd.set("remove", "1");
      return done(await treePhotoAction(token, fd));
    } catch {
      return done({ ok: false, message: "Нет связи. Проверьте интернет и попробуйте ещё раз." });
    }
  };

  const open = (id: string, m: Mode = "view") => {
    setSelected(id);
    setMode(m);
    setNotice(null);
  };

  const people = model.nodes.length + model.hidden.length;

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <div role="status" className={`rounded-card border px-4 py-3 ${notice.ok ? "border-jade/50 bg-paper" : "border-danger/50 bg-paper text-danger"}`}>
          {notice.ok ? "✓ " : ""}
          {notice.message}
        </div>
      )}

      {model.nodes.length === 0 ? (
        <p className="rounded-card bg-paper-deep p-4 text-ink-soft">
          Древо появится, когда соберётся первая глава. А пока можно добавить людей вручную — внизу страницы.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div role="tablist" aria-label="Как показать древо" className="inline-flex rounded-button border border-line bg-paper p-1">
              {(
                [
                  ["tree", "Древом"],
                  ["list", "Списком"],
                ] as const
              ).map(([v, t]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`min-h-12 rounded-button px-5 text-base ${view === v ? "bg-ink font-semibold text-paper" : "text-ink-soft"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="text-sm text-muted">{people} чел.</span>
          </div>

          {view === "tree" ? (
            <TreeCanvas model={model} photos={photos} showKo={showKo} rowLang={rowLang} selected={selected} onOpen={open} token={token} book={book} opened={opened} focusId={focusId} />
          ) : (
            <TreeList model={model} photos={photos} showKo={showKo} rowLang={rowLang} onOpen={open} />
          )}

          {view === "tree" && (
            <p className="text-sm text-muted">
              Пунктир — человек стоит по слову из рассказа («бабушка»), но ещё не связан с остальными: нажмите и выберите, чья.
              {model.chips.length > 0 && (
                <>
                  {" "}
                  Чтобы древо не мельчило, ветки двоюродных свёрнуты — нажмите «+ ещё» или{" "}
                  <Link href={treeHref(token, book, "all")} scroll={false} className="inline-flex min-h-12 items-center text-seal underline underline-offset-4">
                    покажите всех
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </>
      )}

      {model.others.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm tracking-widest text-seal uppercase">Ещё в рассказах</h2>
          <p className="text-ink-soft">Люди из глав, о которых не сказано, кем приходятся. Если это родня — нажмите и поставьте на древо.</p>
          <ul className="flex flex-wrap gap-2">
            {model.others.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="min-h-12 rounded-button border border-line bg-paper px-4 py-2 text-left text-base"
                  onClick={() => open(o.id, "view")}
                  aria-label={`${o.name}${o.label ? `, ${o.label.ru}` : ""} — поставить на древо`}
                >
                  <span className="font-serif">{o.name}</span>
                  {o.label && <span className="text-ink-soft"> · {o.label.ru}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AddPerson nodes={model.nodes} busy={busy} onSubmit={run} />

      <p className="text-sm text-muted">
        Имена здесь не меняют текст глав. Чтобы поправить, как имя написано в книге, — откройте{" "}
        <Link href={`/f/${token}/names`} className="inline-flex min-h-12 items-center text-seal underline underline-offset-4">
          Словарь имён
        </Link>
        .
      </p>

      {node && (
        <Sheet onClose={() => (setSelected(null), setMode("view"))}>
          <PersonSheet
            key={`${node.id}:${mode}`}
            n={node}
            photo={photos[node.id]}
            mode={mode}
            setMode={setMode}
            busy={busy}
            token={token}
            familyName={familyName}
            showKo={showKo}
            everyone={everyone}
            placed={[...model.nodes, ...model.hidden]}
            ownBook={storytellers.some((s) => s.id === node.storytellerId)}
            chapterTitles={chapterTitles}
            onSubmit={run}
            onPhoto={(file) => photo(node.id, file)}
          />
        </Sheet>
      )}
    </div>
  );
}

// ---------------- окно древа: перетаскивание, щипок, кнопки ----------------

function TreeCanvas({
  model,
  photos,
  showKo,
  rowLang,
  selected,
  onOpen,
  token,
  book,
  opened,
  focusId,
}: {
  model: TreeModel;
  photos: Record<string, string>;
  showKo: boolean;
  rowLang: RowLang;
  selected: string | null;
  onOpen: (id: string) => void;
  token: string;
  book: string | null;
  opened: string[] | "all";
  focusId: string | null;
}) {
  const vp = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Xform | null>(null);
  const [animate, setAnimate] = useState(false);
  const tRef = useRef<Xform | null>(null);
  const [viewH, setViewH] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: Xform; p0: { x: number; y: number }; dist: number; moved: boolean } | null>(null);
  const suppress = useRef(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const size = () => ({ W: vp.current?.clientWidth ?? 360, H: vp.current?.clientHeight ?? 560 });
  const fitScale = () => {
    const { W, H } = size();
    return Math.min(1, (W - 16) / Math.max(1, model.width), (H - 16) / Math.max(1, model.height));
  };
  const minScale = () => Math.min(0.3, fitScale());

  const clampX = useCallback(
    (x: Xform): Xform => {
      const { W, H } = size();
      const s = clamp(x.s, minScale(), MAX_SCALE);
      const cw = model.width * s;
      const ch = model.height * s;
      const m = 96; // край древа не уезжает дальше, чем на 96 px от края окна
      return { s, x: clamp(x.x, Math.min(m - cw, (W - cw) / 2), Math.max(W - m, (W - cw) / 2)), y: clamp(x.y, Math.min(m - ch, (H - ch) / 2), Math.max(H - m, (H - ch) / 2)) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- размеры окна читаем в момент вызова
    [model.width, model.height],
  );

  /** Новое положение древа: и в ref (жесты читают его без перерисовки), и в state */
  const put = useCallback((x: Xform) => {
    tRef.current = x;
    setT(x);
  }, []);

  const go = useCallback(
    (next: Xform, anim = true) => {
      if (animTimer.current) clearTimeout(animTimer.current);
      setAnimate(anim);
      put(clampX(next));
      if (anim) animTimer.current = setTimeout(() => setAnimate(false), ANIM_MS + 40);
    },
    [clampX, put],
  );

  const centerOn = useCallback(
    (box: Box, scale?: number, anim = true) => {
      const { W, H } = size();
      const s = scale ?? clamp(Math.min(1, (W - 24) / box.w, (H - 24) / box.h), minScale(), MAX_SCALE);
      go({ s, x: W / 2 - (box.x + box.w / 2) * s, y: H / 2 - (box.y + box.h / 2) * s }, anim);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- см. clampX
    [go],
  );

  const boxOf = (id: string): Box | null => {
    const n = model.nodes.find((x) => x.id === id);
    return n ? { x: n.x - CARD.capsule, y: n.y - CARD.capsule, w: CARD.w + CARD.capsule * 2, h: CARD.h + CARD.capsule * 2 } : null;
  };
  /** Рассказчик с парой — по центру окна; родители и дети — тоже в окне, если влезают по высоте */
  const toViewer = (anim = true) => {
    const f = model.focus;
    if (!f) return fitAll(anim);
    const { W, H } = size();
    const s = clamp(Math.min(1, (W - 24) / f.w, (H - 24) / f.h), minScale(), MAX_SCALE);
    // родители (и дети) — тоже в окне, если влезают; по ширине — середина «дома», если влез и он, иначе пара
    const h = model.homes.find((b) => b.h * s <= H - 24) ?? f;
    const cx = h.w * s <= W - 24 ? h.x + h.w / 2 : f.x + f.w / 2;
    go({ s, x: W / 2 - cx * s, y: H / 2 - (h.y + h.h / 2) * s }, anim);
  };
  const fitAll = (anim = true) => {
    const { W, H } = size();
    const s = fitScale();
    go({ s, x: (W - model.width * s) / 2, y: (H - model.height * s) / 2 }, anim);
  };
  const zoom = (k: number) => {
    const cur = tRef.current;
    if (!cur) return;
    const { W, H } = size();
    const s = clamp(cur.s * k, minScale(), MAX_SCALE);
    go({ s, x: W / 2 - ((W / 2 - cur.x) / cur.s) * s, y: H / 2 - ((H / 2 - cur.y) / cur.s) * s });
  };

  // при открытии и после «+ ещё»: рассказчик с парой (или развёрнутая ветка) — в центре окна
  // (в следующем кадре: окно уже измерено; до этого древо скрыто — без «прыжка»)
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      const f = focusId ? boxOf(focusId) : null;
      if (f) {
        const kids = model.nodes.some((n) => n.y > f.y && Math.abs(n.x + CARD.w / 2 - (f.x + f.w / 2)) < 600);
        const { W } = size();
        centerOn({ ...f, h: f.h + (kids ? CARD.h + CARD.gapY + CARD.label : 0) }, Math.min(1, W / 420), false);
      } else toViewer(false);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при новой раскладке
  }, [model, focusId]);

  // колесо с Ctrl / щипок трекпада — масштаб; Safari: свой щипок страницы внутри окна не нужен
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const cur = tRef.current;
      if (!cur) return;
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const s = clamp(cur.s * Math.exp(-e.deltaY / 300), minScale(), MAX_SCALE);
      go({ s, x: px - ((px - cur.x) / cur.s) * s, y: py - ((py - cur.y) / cur.s) * s }, false);
    };
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", stop);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- см. clampX
  }, [go]);

  const local = (e: React.PointerEvent) => {
    const r = vp.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startGesture = () => {
    const cur = tRef.current;
    if (!cur) return;
    const ps = [...pointers.current.values()];
    const mid = ps.length >= 2 ? { x: (ps[0]!.x + ps[1]!.x) / 2, y: (ps[0]!.y + ps[1]!.y) / 2 } : ps[0]!;
    const dist = ps.length >= 2 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y) : 0;
    gesture.current = { start: cur, p0: mid, dist, moved: gesture.current?.moved ?? false };
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) gesture.current = null;
    if (animate) setAnimate(false);
    startGesture();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    const ps = [...pointers.current.values()];
    if (ps.length >= 2 && g.dist > 0) {
      const mid = { x: (ps[0]!.x + ps[1]!.x) / 2, y: (ps[0]!.y + ps[1]!.y) / 2 };
      const dist = Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y);
      const s = clamp(g.start.s * (dist / g.dist), minScale(), MAX_SCALE);
      const cx = (g.p0.x - g.start.x) / g.start.s;
      const cy = (g.p0.y - g.start.y) / g.start.s;
      g.moved = true;
      put(clampX({ s, x: mid.x - cx * s, y: mid.y - cy * s }));
    } else if (ps.length === 1) {
      const dx = ps[0]!.x - g.p0.x;
      const dy = ps[0]!.y - g.p0.y;
      if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      g.moved = true;
      put(clampX({ ...g.start, x: g.start.x + dx, y: g.start.y + dy }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (gesture.current?.moved) suppress.current = true;
    if (pointers.current.size) startGesture();
    else setTimeout(() => (suppress.current = false), 400);
  };

  // фокус с клавиатуры / прокрутка браузером (scrollIntoView) — переводим в сдвиг древа
  const onScroll = () => {
    const el = vp.current;
    const cur = tRef.current;
    if (!el || !cur || (!el.scrollLeft && !el.scrollTop)) return;
    const next = { ...cur, x: cur.x - el.scrollLeft, y: cur.y - el.scrollTop };
    el.scrollLeft = 0;
    el.scrollTop = 0;
    setAnimate(false);
    put(next);
  };

  // высота окна — для подписей рядов (видна ли подпись)
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const viewerFemale = model.nodes.find((n) => n.isViewer)?.gender === "f";
  const H = viewH || 2000;

  return (
    <div className="flex flex-col gap-3">
    <div
      ref={vp}
      data-testid="tree"
      className="relative -mx-5 h-[min(68dvh,620px)] touch-none overflow-hidden border-y border-line bg-paper-deep/40 select-none sm:mx-0 sm:rounded-card sm:border"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onScroll={onScroll}
      onClickCapture={(e) => {
        if (suppress.current) {
          e.preventDefault();
          e.stopPropagation();
          suppress.current = false;
        }
      }}
    >
      <div
        className={`absolute top-0 left-0 origin-top-left ${t ? "" : "invisible"}`}
        style={{
          width: model.width,
          height: model.height,
          transform: t ? `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.s})` : undefined,
          transition: animate ? `transform ${ANIM_MS}ms ease-out` : undefined,
        }}
      >
        <svg className="pointer-events-none absolute inset-0" width={model.width} height={model.height} aria-hidden>
          {model.capsules.map((c, i) => (
            <rect
              key={`c${i}`}
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              rx={24}
              className={c.outline ? "fill-none stroke-line" : "fill-paper-deep stroke-line"}
              strokeWidth={1.5}
            />
          ))}
          {model.lines.map((l, i) => (
            <path
              key={i}
              d={l.d}
              fill="none"
              className={l.kind === "sibling" ? "stroke-muted" : "stroke-gold"}
              strokeWidth={l.kind === "sibling" ? 1.5 : 2}
              strokeDasharray={l.kind === "sibling" ? "4 4" : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        {model.nodes.map((n) => (
          <PersonCard key={n.id} n={n} photo={photos[n.id]} showKo={showKo} active={n.id === selected} onOpen={() => onOpen(n.id)} />
        ))}
        {model.chips.map((c) => {
          const owner = model.nodes.find((n) => n.id === c.owner);
          const nextOpen = opened === "all" ? "all" : [...opened, c.owner];
          return (
            <Link
              key={c.owner}
              href={treeHref(token, book, nextOpen, c.owner)}
              scroll={false}
              data-testid="tree-more"
              aria-label={`Показать ещё ${c.count}: семья ${owner?.name ?? ""}`}
              className="absolute flex items-center justify-center rounded-button border border-gold bg-paper text-base font-semibold text-ink shadow-card"
              style={{ left: c.x, top: c.y, width: CARD.chipW, height: CARD.chipH }}
            >
              + ещё {c.count}
            </Link>
          );
        })}
      </div>

      {/* подписи рядов — прилипают к левому краю окна */}
      {t &&
        model.rows.map((r) => {
          const title = rowTitle(r.rel, rowLang, viewerFemale);
          if (!title || t.s < 0.5) return null; // мелко — подпись закрыла бы карточки
          const y = t.y + r.y * t.s + Math.max(0, (CARD.label * t.s - 24) / 2);
          if (y < -24 || y > H) return null;
          return (
            <div
              key={r.gen}
              className="pointer-events-none absolute top-0 left-2 rounded-button border border-line bg-paper/90 px-3 py-0.5 text-[11px] leading-5 tracking-widest text-muted uppercase"
              style={{ transform: `translateY(${y}px)`, transition: animate ? `transform ${ANIM_MS}ms ease-out` : undefined }}
              data-testid="tree-row-title"
            >
              {title.ru}
              {title.second && (
                <span lang={title.lang ?? undefined} className="tracking-normal normal-case">
                  {" "}
                  · {title.second}
                </span>
              )}
            </div>
          );
        })}

    </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Масштаб древа">
        <button type="button" className={round} onClick={() => zoom(0.8)} aria-label="Мельче">
          −
        </button>
        <button type="button" className={round} onClick={() => zoom(1.25)} aria-label="Крупнее">
          +
        </button>
        <button type="button" className={tool} onClick={() => toViewer()} aria-label="К рассказчику">
          <span aria-hidden>⌖</span> К рассказчику
        </button>
        <button type="button" className={tool} onClick={() => fitAll()} aria-label="Всё древо">
          <span aria-hidden>⤢</span> Всё древо
        </button>
      </div>
    </div>
  );
}

function PersonCard({ n, photo, showKo, active, onOpen }: { n: TreeNode; photo?: string; showKo: boolean; active: boolean; onOpen: () => void }) {
  const border = n.isViewer ? "border-2 border-seal" : n.loose ? "border border-dashed border-muted" : "border border-line";
  // длинное имя (ФИО) — до 3 строк мельче, короткое — до 2; длиннее — «…», целиком — в листе по нажатию
  const words = n.name.trim().split(/\s+/);
  const long = n.name.length > 16 && words.length >= 2;
  // слово длиннее 12 букв («Константинович») не влезает в строку 14 px — мельче, а не перенос посреди слова
  const huge = words.some((w) => w.length > 12);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="tree-person"
      aria-label={ariaName(n)}
      className={`absolute block overflow-hidden rounded-card bg-paper p-0 text-center shadow-card ${border} ${active ? "ring-2 ring-ink" : ""}`}
      style={{ left: n.x, top: n.y, width: CARD.w, height: CARD.h }}
    >
      {/* содержимое прижато к верху: Safari центрирует содержимое кнопки — так ничего не уходит вверх (#277) */}
      <span className="flex h-full w-full flex-col items-center justify-start gap-1 px-2 pt-2.5 pb-2">
        <Avatar n={n} photo={photo} size="card" />
        <span
          lang="ru"
          data-testid="tree-name"
          className={`w-full font-serif break-words hyphens-auto text-ink ${huge ? "line-clamp-3 text-[12px] leading-[1.15]" : long ? "line-clamp-3 text-[13px] leading-[1.15]" : "line-clamp-2 text-[14px] leading-[1.2]"}`}
        >
          {n.name}
        </span>
        {showKo && n.nameKo && (
          <span lang="ko" className="w-full truncate text-xs leading-tight text-ink-soft">
            {n.nameKo}
          </span>
        )}
        {n.years && <span className="text-xs leading-tight text-muted">{n.years}</span>}
        {(n.isViewer || n.label) && (
          <span className={`mt-auto w-full truncate text-[11px] leading-tight tracking-wide uppercase ${n.isViewer ? "text-seal" : "text-jade"}`}>
            {n.isViewer ? "📖 книга" : n.label!.ru}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------------- вид «Списком» ----------------

function TreeList({ model, photos, showKo, rowLang, onOpen }: { model: TreeModel; photos: Record<string, string>; showKo: boolean; rowLang: RowLang; onOpen: (id: string) => void }) {
  const viewerFemale = model.nodes.find((n) => n.isViewer)?.gender === "f";
  const byGen = new Map<number, TreeNode[]>();
  for (const n of [...model.nodes, ...model.hidden]) byGen.set(n.gen, [...(byGen.get(n.gen) ?? []), n]);
  const order = new Map(model.rows.flatMap((r) => r.ids).map((id, i) => [id, i]));
  const gens = [...byGen.keys()].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-5" data-testid="tree-list">
      {gens.map((g) => {
        const list = byGen.get(g)!.sort((a, b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6) || (a.birthYear ?? 9999) - (b.birthYear ?? 9999));
        const title = rowTitle(list[0]!.rel, rowLang, viewerFemale);
        return (
          <section key={g} className="flex flex-col gap-2">
            <h2 className="text-sm tracking-widest text-muted uppercase">
              {title?.ru ?? "Поколение"}
              {title?.second && (
                <span lang={title.lang ?? undefined} className="tracking-normal normal-case">
                  {" "}
                  · {title.second}
                </span>
              )}
            </h2>
            <ul className="flex flex-col gap-2">
              {list.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(n.id)}
                    aria-label={ariaName(n)}
                    className={`flex min-h-16 w-full items-center gap-3 rounded-card border bg-paper px-3 py-2 text-left ${n.isViewer ? "border-seal" : n.loose ? "border-dashed border-muted" : "border-line"}`}
                  >
                    <Avatar n={n} photo={photos[n.id]} size="list" />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-serif text-lg leading-snug break-words">{n.name}</span>
                      {showKo && n.nameKo && (
                        <span lang="ko" className="text-sm text-ink-soft">
                          {n.nameKo}
                        </span>
                      )}
                      <span className="text-sm text-muted">{[n.isViewer ? "📖 книга" : n.label?.ru, n.years].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ---------------- лист человека ----------------

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-card bg-paper px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-button bg-line" aria-hidden />
        {children}
        <button type="button" onClick={onClose} className={`${secondary} mt-4 w-full`}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

function PersonSheet({
  n,
  photo,
  mode,
  setMode,
  busy,
  token,
  familyName,
  showKo,
  everyone,
  placed,
  ownBook,
  chapterTitles,
  onSubmit,
  onPhoto,
}: {
  n: TreeNode;
  photo?: string;
  mode: Mode;
  setMode: (m: Mode) => void;
  busy: boolean;
  token: string;
  familyName: string;
  showKo: boolean;
  everyone: TreeNode[];
  placed: TreeNode[];
  ownBook: boolean;
  chapterTitles: Record<string, string>;
  onSubmit: (op: TreeOp) => Promise<boolean>;
  onPhoto: (file: File | null) => Promise<boolean>;
}) {
  const [form, setForm] = useState({
    name: n.realName ?? "",
    nameKo: n.kinOnly ? "" : (n.nameKo ?? ""),
    birthYear: n.birthYear ? String(n.birthYear) : "",
    deathYear: n.deathYear ? String(n.deathYear) : "",
    gender: n.gender,
  });
  const [into, setInto] = useState("");
  const [sure, setSure] = useState(false);
  const [role, setRole] = useState<PlaceRole | "">("");
  const [other, setOther] = useState("");
  const others = everyone.filter((o) => o.id !== n.id);
  const target = others.find((o) => o.id === into);
  const onTree = placed.some((p) => p.id === n.id);
  const chapters = n.storyIds.filter((id) => chapterTitles[id]);
  const born = n.gender === "f" ? "родилась" : n.gender === "m" ? "родился" : "место рождения:";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <Avatar n={n} photo={photo} size="sheet" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-serif text-2xl leading-tight break-words" data-testid="sheet-name">
            {n.name}
            {showKo && n.nameKo && (
              <span className="text-ink-soft" lang="ko">
                {" "}· {n.nameKo}
              </span>
            )}
          </p>
          <p className="text-ink-soft">{[n.isViewer ? "📖 своя книга" : n.label?.ru, n.years].filter(Boolean).join(" · ")}</p>
          {n.place && (
            <p className="text-ink-soft">
              {born} {n.place}
            </p>
          )}
          {n.kinOnly && <p className="text-sm text-muted">Имя пока не записано — впишите, если знаете.</p>}
          {n.checked && <p className="text-sm text-jade">✓ проверено семьёй</p>}
        </div>
      </div>

      {mode === "view" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className={`${secondary} inline-flex cursor-pointer items-center ${busy ? "opacity-50" : ""}`}>
              📷 {photo ? "Другое фото" : "Добавить фото"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                data-testid="photo-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onPhoto(f);
                }}
              />
            </label>
            {n.ownPhoto && (
              <button type="button" className={secondary} disabled={busy} onClick={() => void onPhoto(null)}>
                Убрать фото
              </button>
            )}
          </div>
          {busy && <p className="text-sm text-muted">Сохраняем…</p>}

          {chapters.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm tracking-widest text-muted uppercase">Вспоминают в главах</p>
              <div className="flex flex-wrap gap-2">
                {chapters.map((id) => (
                  <Link key={id} href={`/chapter/${id}?token=${encodeURIComponent(token)}`} className="inline-flex min-h-12 items-center rounded-button bg-paper-deep px-4 text-ink-soft">
                    {chapterTitles[id]} →
                  </Link>
                ))}
              </div>
            </div>
          )}

          {n.storytellerId && ownBook ? (
            <Link href={`/book/${token}`} className={`${linkRow} border border-gold bg-paper-deep font-semibold`}>
              <span>📖 Открыть книгу «{familyName}»</span>
              <span className="text-seal">→</span>
            </Link>
          ) : (
            <Link href={recordHref(token, familyName, n)} className={`${linkRow} bg-seal font-semibold text-paper`} data-testid="record-story">
              <span>{recordLabel(n)}</span>
              <span>→</span>
            </Link>
          )}
          {!n.storytellerId && <p className="-mt-1 text-sm text-muted">Вторая книга в семье — со скидкой 40 %, древо в подарок.</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondary} onClick={() => setMode("edit")}>
              ✎ Исправить
            </button>
            {others.length > 0 && (
              <button type="button" className={secondary} onClick={() => setMode("merge")}>
                Это тот же человек…
              </button>
            )}
            {placed.length > 0 && !n.isViewer && (
              <button type="button" className={onTree ? secondary : `${secondary} border-seal`} onClick={() => setMode("place")}>
                {onTree ? "Поставить на место" : "Поставить на древо"}
              </button>
            )}
          </div>
        </div>
      )}

      {mode === "edit" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit({ op: "update", id: n.id, name: form.name, nameKo: showKo ? form.nameKo : undefined, birthYear: form.birthYear, deathYear: form.deathYear, gender: form.gender });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">Имя</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} className={field} autoComplete="off" placeholder={n.kinOnly ? `Как звали? (${n.name.toLowerCase()})` : ""} disabled={busy} />
          </label>
          {showKo && (
            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted">По-корейски</span>
              <input value={form.nameKo} onChange={(e) => setForm({ ...form, nameKo: e.target.value })} maxLength={80} className={field} lang="ko" autoComplete="off" disabled={busy} />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted">Год рождения</span>
              <input value={form.birthYear} onChange={(e) => setForm({ ...form, birthYear: e.target.value })} inputMode="numeric" maxLength={4} className={field} placeholder="1915" disabled={busy} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted">Год смерти</span>
              <input value={form.deathYear} onChange={(e) => setForm({ ...form, deathYear: e.target.value })} inputMode="numeric" maxLength={4} className={field} placeholder="если ушёл" disabled={busy} />
            </label>
          </div>
          <div className="flex gap-2" role="radiogroup" aria-label="Он или она">
            {(
              [
                ["m", "Он"],
                ["f", "Она"],
              ] as const
            ).map(([g, t]) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={form.gender === g}
                onClick={() => setForm({ ...form, gender: g })}
                className={`min-h-12 flex-1 rounded-button border px-4 ${form.gender === g ? "border-ink bg-paper-deep font-semibold" : "border-line bg-paper text-ink-soft"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primary} disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
            <button type="button" className={secondary} onClick={() => setMode("view")} disabled={busy}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {mode === "merge" && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span>«{n.name}» — это тот же человек, что…</span>
            <select value={into} onChange={(e) => (setInto(e.target.value), setSure(false))} className={field} disabled={busy}>
              <option value="">выберите</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.label ? ` (${o.label.ru})` : ""}
                </option>
              ))}
            </select>
          </label>
          {target && <p className="text-sm text-ink-soft">На древе останется «{target.name}». Тексты глав не меняются.</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} disabled={busy || !into} onClick={() => (sure ? void onSubmit({ op: "merge", id: n.id, into }) : setSure(true))}>
              {busy ? "Объединяем…" : sure ? "Да, это один человек" : "Объединить"}
            </button>
            <button type="button" className={secondary} onClick={() => setMode("view")} disabled={busy}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {mode === "place" && (
        <div className="flex flex-col gap-3">
          <p>
            <span className="font-semibold">{n.name}</span> — это…
          </p>
          <select value={role} onChange={(e) => setRole(e.target.value as PlaceRole | "")} className={field} disabled={busy} aria-label="Кем приходится">
            <option value="">кем приходится</option>
            {PLACE_ROLES.map((r) => (
              <option key={r.role} value={r.role}>
                {r.ru}
              </option>
            ))}
          </select>
          <select value={other} onChange={(e) => setOther(e.target.value)} className={field} disabled={busy} aria-label="Для кого">
            <option value="">для кого</option>
            {placed
              .filter((o) => o.id !== n.id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.label ? ` (${o.label.ru})` : ""}
                </option>
              ))}
          </select>
          <p className="text-sm text-muted">Прежние связи этого человека на древе заменятся новой.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} disabled={busy || !role || !other} onClick={() => role && void onSubmit({ op: "place", id: n.id, role, other })}>
              {busy ? "Сохраняем…" : "Поставить"}
            </button>
            <button type="button" className={secondary} onClick={() => setMode("view")} disabled={busy}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddPerson({ nodes, busy, onSubmit }: { nodes: TreeNode[]; busy: boolean; onSubmit: (op: TreeOp) => Promise<boolean> }) {
  const empty = { name: "", nameKo: "", birthYear: "", deathYear: "", role: "" as PlaceRole | "", other: "" };
  const [form, setForm] = useState(empty);
  if (nodes.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      <h2 className="font-serif text-2xl">Добавить человека</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.role) return;
          const ok = await onSubmit({ op: "add", name: form.name, nameKo: form.nameKo || null, birthYear: form.birthYear, deathYear: form.deathYear, role: form.role, other: form.other });
          if (ok) setForm(empty);
        }}
      >
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} className={field} placeholder="Имя, например: Ли Мария" autoComplete="off" disabled={busy} aria-label="Имя" />
        <div className="grid grid-cols-2 gap-3">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as PlaceRole | "" })} className={field} disabled={busy} aria-label="Кем приходится">
            <option value="">кем приходится</option>
            {PLACE_ROLES.map((r) => (
              <option key={r.role} value={r.role}>
                {r.ru}
              </option>
            ))}
          </select>
          <select value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} className={field} disabled={busy} aria-label="Для кого">
            <option value="">для кого</option>
            {nodes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input value={form.birthYear} onChange={(e) => setForm({ ...form, birthYear: e.target.value })} inputMode="numeric" maxLength={4} className={field} placeholder="Год рождения" disabled={busy} aria-label="Год рождения" />
          <input value={form.deathYear} onChange={(e) => setForm({ ...form, deathYear: e.target.value })} inputMode="numeric" maxLength={4} className={field} placeholder="Год смерти" disabled={busy} aria-label="Год смерти" />
        </div>
        <button type="submit" className={`${primary} self-start`} disabled={busy || !form.name.trim() || !form.role || !form.other}>
          {busy ? "Добавляем…" : "Добавить"}
        </button>
      </form>
    </section>
  );
}
