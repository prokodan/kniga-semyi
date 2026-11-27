"use client";
// #235: древо на телефоне. Линии — SVG, люди — кнопки поверх (крупные, ≥ 48 px, читаются экранным диктором).
// Тап по человеку → карточка снизу: книга / «Записать историю мамы» / исправить / «это тот же человек» / поставить на место.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PLACE_ROLES, type PlaceRole } from "@/lib/tree/edit";
import { CARD, type TreeModel, type TreeNode } from "@/lib/tree/layout";
import { treeAction, type TreeOp, type TreeOpResult } from "./actions";

const field = "w-full rounded-card border border-line bg-paper px-4 py-3 text-lg text-ink placeholder:text-muted focus:border-ink focus:outline-none";
const primary = "min-h-12 rounded-button bg-seal px-6 py-3 text-lg font-semibold text-paper active:bg-seal-dark disabled:opacity-50";
const secondary = "min-h-12 rounded-button border border-line bg-paper px-4 py-3 text-lg text-ink disabled:opacity-50";
const linkRow = "flex min-h-12 items-center justify-between gap-3 rounded-card px-4 py-3";

type Mode = "view" | "edit" | "merge" | "place";

interface Props {
  token: string;
  familyName: string;
  model: TreeModel;
  photos: Record<string, string>;
  showKo: boolean;
  storytellers: { id: string; name: string }[];
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

export function TreeView({ token, familyName, model, photos, showKo, storytellers }: Props) {
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [notice, setNotice] = useState<TreeOpResult | null>(null);
  const [busy, setBusy] = useState(false);
  const everyone = useMemo(() => [...model.nodes, ...model.others], [model]);
  const node = everyone.find((n) => n.id === selected) ?? null;

  // рассказчик — в середине экрана
  useEffect(() => {
    const el = scroller.current;
    const v = model.nodes.find((n) => n.isViewer);
    if (el && v) el.scrollLeft = Math.max(0, v.x + CARD.w / 2 - el.clientWidth / 2);
  }, [model]);

  const run = async (op: TreeOp) => {
    setBusy(true);
    let r: TreeOpResult;
    try {
      r = await treeAction(token, op);
    } catch {
      r = { ok: false, message: "Нет связи. Проверьте интернет и попробуйте ещё раз." };
    }
    setBusy(false);
    setNotice(r);
    if (r.ok) {
      setMode("view");
      setSelected(null);
      router.refresh();
    }
    return r.ok;
  };

  const open = (id: string, m: Mode = "view") => {
    setSelected(id);
    setMode(m);
    setNotice(null);
  };

  return (
    <div className="flex flex-col gap-6">
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
        <div ref={scroller} className="-mx-5 overflow-x-auto px-5 pb-2" data-testid="tree">
          <div className="relative mx-auto" style={{ width: model.width, height: model.height }}>
            <svg className="pointer-events-none absolute inset-0" width={model.width} height={model.height} aria-hidden>
              {model.lines.map((l, i) => (
                <path
                  key={i}
                  d={l.d}
                  fill="none"
                  className={l.kind === "spouse" ? "stroke-seal" : l.kind === "sibling" ? "stroke-muted" : "stroke-gold"}
                  strokeWidth={l.kind === "spouse" ? 2.5 : 1.75}
                  strokeDasharray={l.kind === "sibling" ? "4 4" : undefined}
                  strokeLinecap="round"
                />
              ))}
            </svg>
            {model.nodes.map((n) => (
              <PersonCard key={n.id} n={n} photo={photos[n.id]} showKo={showKo} active={n.id === selected} onOpen={() => open(n.id)} />
            ))}
          </div>
        </div>
      )}

      {model.nodes.length > 0 && (
        <p className="text-sm text-muted">
          Пунктир — человек стоит по слову из рассказа («бабушка»), но ещё не связан с остальными: нажмите и выберите, чья.
        </p>
      )}

      {model.others.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm tracking-widest text-seal uppercase">Ещё в рассказах</h2>
          <p className="text-ink-soft">Люди из глав, о которых не сказано, кем приходятся. Если это родня — поставьте на древо.</p>
          <ul className="flex flex-col gap-2">
            {model.others.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-paper px-4 py-3">
                <span>
                  <span className="font-serif text-xl">{o.name}</span>
                  {o.label && <span className="text-ink-soft"> · {o.label.ru}</span>}
                </span>
                <button type="button" className={secondary} onClick={() => open(o.id, "place")}>
                  Поставить на древо
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
            mode={mode}
            setMode={setMode}
            busy={busy}
            token={token}
            familyName={familyName}
            showKo={showKo}
            everyone={everyone}
            placed={model.nodes}
            ownBook={storytellers.some((s) => s.id === node.storytellerId)}
            onSubmit={run}
          />
        </Sheet>
      )}
    </div>
  );
}

function PersonCard({ n, photo, showKo, active, onOpen }: { n: TreeNode; photo?: string; showKo: boolean; active: boolean; onOpen: () => void }) {
  const border = n.isViewer ? "border-2 border-seal" : n.loose ? "border border-dashed border-muted" : "border border-line";
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="tree-person"
      aria-label={[n.name, n.label?.ru, n.years].filter(Boolean).join(", ")}
      className={`absolute flex flex-col items-center gap-1 rounded-card bg-paper px-2 pt-2 pb-2 text-center shadow-card ${border} ${active ? "ring-2 ring-ink" : ""}`}
      style={{ left: n.x, top: n.y, width: CARD.w, height: CARD.h }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка Storage, next/image не нужен
        <img src={photo} alt="" className="size-12 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden className={`flex size-12 shrink-0 items-center justify-center rounded-full font-serif text-xl ${n.isViewer ? "bg-seal text-paper" : "bg-paper-deep text-seal"}`}>
          {initial(n.name)}
        </span>
      )}
      <span className="line-clamp-2 font-serif text-[15px] leading-tight text-ink">{n.name}</span>
      {showKo && n.nameKo && (
        <span lang="ko" className="truncate text-xs leading-tight text-ink-soft" style={{ maxWidth: CARD.w - 16 }}>
          {n.nameKo}
        </span>
      )}
      <span className="mt-auto flex flex-col items-center leading-tight">
        {n.years && <span className="text-xs text-muted">{n.years}</span>}
        {n.label && <span className={`text-[11px] tracking-wide uppercase ${n.isViewer ? "text-seal" : "text-jade"}`}>{n.isViewer ? "📖 книга" : n.label.ru}</span>}
      </span>
    </button>
  );
}

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
  mode,
  setMode,
  busy,
  token,
  familyName,
  showKo,
  everyone,
  placed,
  ownBook,
  onSubmit,
}: {
  n: TreeNode;
  mode: Mode;
  setMode: (m: Mode) => void;
  busy: boolean;
  token: string;
  familyName: string;
  showKo: boolean;
  everyone: TreeNode[];
  placed: TreeNode[];
  ownBook: boolean;
  onSubmit: (op: TreeOp) => Promise<boolean>;
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-serif text-2xl leading-tight">
          {n.name}
          {showKo && n.nameKo && (
            <span className="text-ink-soft" lang="ko">
              {" "}· {n.nameKo}
            </span>
          )}
        </p>
        <p className="text-ink-soft">{[n.label?.ru, n.years, n.chapters ? `в главах: ${n.chapters}` : null].filter(Boolean).join(" · ")}</p>
        {n.kinOnly && <p className="text-sm text-muted">Имя пока не записано — впишите, если знаете.</p>}
        {n.checked && <p className="text-sm text-jade">✓ проверено семьёй</p>}
      </div>

      {mode === "view" && (
        <div className="flex flex-col gap-3">
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
              <button type="button" className={secondary} onClick={() => setMode("place")}>
                Поставить на место
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
