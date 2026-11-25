"use client";
// Словарь имён (#104): записи по группам, правка написания RU / KR и описания, объединение двух записей,
// добавление вручную. Сохранение — ручки /api/families/<токен>/entities; после ответа страница обновляется.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FamilyEntity, FamilyEntityKind } from "@/lib/types";

export interface ChapterRef {
  id: string;
  title: string;
}

const KINDS: { kind: FamilyEntityKind; ru: string; ko: string; one: string; empty: string }[] = [
  { kind: "person", ru: "Люди", ko: "사람", one: "Человек", empty: "Пока никого" },
  { kind: "place", ru: "Места", ko: "장소", one: "Место", empty: "Пока ни одного места" },
  { kind: "word", ru: "Слова", ko: "낱말", one: "Слово", empty: "Пока ни одного слова" },
];

const field = "w-full rounded-card border border-line bg-paper px-4 py-3 text-lg text-ink placeholder:text-muted focus:border-ink focus:outline-none";
const primary = "min-h-12 rounded-button bg-seal px-6 py-3 text-lg font-semibold text-paper active:bg-seal-dark disabled:opacity-50";
const secondary = "min-h-12 rounded-button border border-line bg-paper px-4 py-3 text-lg text-ink disabled:opacity-50";

interface Notice {
  ok: boolean;
  text: string;
  book?: boolean;
}

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: { message?: string; bookOutdated?: boolean } }> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { message?: string; bookOutdated?: boolean };
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { message: "Нет связи. Проверьте интернет и попробуйте ещё раз." } };
  }
}

export function NamesEditor({ token, entities, chapters }: { token: string; entities: FamilyEntity[]; chapters: ChapterRef[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  const api = `/api/families/${encodeURIComponent(token)}/entities`;
  const titles = new Map(chapters.map((c) => [c.id, c.title]));

  const done = (r: Awaited<ReturnType<typeof send>>) => {
    setNotice({ ok: r.ok, text: r.data.message ?? (r.ok ? "Сохранили" : "Не получилось сохранить. Попробуйте ещё раз."), book: r.ok && r.data.bookOutdated });
    if (r.ok) router.refresh();
    return r.ok;
  };

  return (
    <div className="flex flex-col gap-8">
      {notice && (
        <div role="status" className={`flex flex-col gap-2 rounded-card border px-4 py-3 ${notice.ok ? "border-jade/50 bg-paper" : "border-danger/50 bg-paper text-danger"}`}>
          <p>{notice.ok ? "✓ " : ""}{notice.text}</p>
          {notice.book && (
            <Link href={`/book/${token}`} className="inline-flex min-h-12 items-center font-semibold text-seal">
              Пересобрать книгу →
            </Link>
          )}
        </div>
      )}

      {entities.length === 0 && (
        <p className="rounded-card bg-paper-deep p-4 text-ink-soft">
          Словарь заполняется сам, когда собирается очередная глава. Пока здесь пусто — можно добавить имена вручную ниже.
        </p>
      )}

      {KINDS.map((k) => {
        const list = entities.filter((e) => e.kind === k.kind);
        if (list.length === 0 && entities.length === 0) return null;
        return (
          <section key={k.kind} className="flex flex-col gap-3">
            <h2 className="text-sm tracking-widest text-seal uppercase">
              {k.ru} <span lang="ko">· {k.ko}</span>
            </h2>
            {list.length === 0 ? (
              <p className="text-muted">{k.empty}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {list.map((e) => (
                  <EntityCard key={e.id} api={api} entity={e} token={token} titles={titles} others={entities.filter((o) => o.id !== e.id && o.kind === e.kind)} onDone={done} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <AddForm api={api} onDone={done} />
    </div>
  );
}

function EntityCard({
  api,
  entity,
  token,
  titles,
  others,
  onDone,
}: {
  api: string;
  entity: FamilyEntity;
  token: string;
  titles: Map<string, string>;
  others: FamilyEntity[];
  onDone: (r: Awaited<ReturnType<typeof send>>) => boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "merge">("view");
  const [form, setForm] = useState({ name_ru: entity.name_ru, name_ko: entity.name_ko ?? "", description: entity.description ?? "" });
  const [into, setInto] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (ev: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: ev.target.value });

  const save = async () => {
    setBusy(true);
    const r = await send(`${api}/${entity.id}`, "PATCH", { name_ru: form.name_ru, name_ko: form.name_ko || null, description: form.description || null });
    setBusy(false);
    if (onDone(r)) setMode("view");
  };
  const merge = async () => {
    if (!sure) return setSure(true);
    setBusy(true);
    const r = await send(`${api}/${entity.id}/merge`, "POST", { into });
    setBusy(false);
    setSure(false);
    if (onDone(r)) setMode("view");
  };
  const stories = entity.story_ids.filter((id) => titles.has(id));
  const target = others.find((o) => o.id === into);

  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-paper p-4">
      {mode === "edit" ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">По-русски</span>
            <input value={form.name_ru} onChange={set("name_ru")} maxLength={80} className={field} autoComplete="off" disabled={busy} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">По-корейски</span>
            <input value={form.name_ko} onChange={set("name_ko")} maxLength={80} className={field} autoComplete="off" lang="ko" disabled={busy} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">Кто это или что это</span>
            <input value={form.description} onChange={set("description")} maxLength={200} className={field} autoComplete="off" disabled={busy} placeholder="например: сосед, друг детства" />
          </label>
          <p className="text-sm text-muted">Новое написание заменит старое во всех главах книги.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void save()} disabled={busy || !form.name_ru.trim()} className={primary}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
            <button type="button" onClick={() => setMode("view")} disabled={busy} className={secondary}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="font-serif text-2xl leading-tight">
            {entity.name_ru}
            {entity.name_ko && (
              <span className="text-ink-soft" lang="ko">
                {" "}· {entity.name_ko}
              </span>
            )}
          </p>
          {entity.description && <p className="text-ink-soft">{entity.description}</p>}
          {entity.source === "family" && <p className="text-sm text-jade">✓ проверено семьёй</p>}
        </div>
      )}

      {stories.length > 0 && mode !== "edit" && (
        <div className="flex flex-wrap gap-2">
          {stories.map((id) => (
            <Link key={id} href={`/chapter/${id}?token=${encodeURIComponent(token)}`} className="inline-flex min-h-12 items-center rounded-button bg-paper-deep px-3 text-sm text-ink-soft">
              {titles.get(id)} →
            </Link>
          ))}
        </div>
      )}

      {mode === "merge" && (
        <div className="flex flex-col gap-3 rounded-card bg-paper-deep p-3">
          <label className="flex flex-col gap-1">
            <span>«{entity.name_ru}» — это то же, что…</span>
            <select value={into} onChange={(ev) => (setInto(ev.target.value), setSure(false))} className={field} disabled={busy}>
              <option value="">выберите</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name_ru}
                  {o.name_ko ? ` · ${o.name_ko}` : ""}
                </option>
              ))}
            </select>
          </label>
          {target && (
            <p className="text-sm text-ink-soft">
              Во всех главах «{entity.name_ru}» заменится на «{target.name_ru}», останется одна запись.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void merge()} disabled={busy || !into} className={primary}>
              {busy ? "Объединяем…" : sure ? "Да, объединить" : "Объединить"}
            </button>
            <button type="button" onClick={() => (setMode("view"), setSure(false))} disabled={busy} className={secondary}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {mode === "view" && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => (setForm({ name_ru: entity.name_ru, name_ko: entity.name_ko ?? "", description: entity.description ?? "" }), setMode("edit"))}
            className={secondary}
          >
            ✎ Исправить
          </button>
          {others.length > 0 && (
            <button type="button" onClick={() => setMode("merge")} className={secondary}>
              Это тот же…
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function AddForm({ api, onDone }: { api: string; onDone: (r: Awaited<ReturnType<typeof send>>) => boolean }) {
  const empty = { kind: "person" as FamilyEntityKind, name_ru: "", name_ko: "", description: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const r = await send(api, "POST", { kind: form.kind, name_ru: form.name_ru, name_ko: form.name_ko || null, description: form.description || null });
    setBusy(false);
    if (onDone(r)) setForm(empty);
  };
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      <h2 className="font-serif text-2xl">Добавить в словарь</h2>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Что добавляем">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={form.kind === k.kind}
            onClick={() => setForm({ ...form, kind: k.kind })}
            className={`min-h-12 rounded-button border px-4 ${form.kind === k.kind ? "border-ink bg-paper-deep font-semibold" : "border-line bg-paper text-ink-soft"}`}
          >
            {k.one}
          </button>
        ))}
      </div>
      <input value={form.name_ru} onChange={(e) => setForm({ ...form, name_ru: e.target.value })} maxLength={80} className={field} placeholder="Как пишется по-русски" autoComplete="off" disabled={busy} />
      <input value={form.name_ko} onChange={(e) => setForm({ ...form, name_ko: e.target.value })} maxLength={80} className={field} placeholder="По-корейски (если знаете)" lang="ko" autoComplete="off" disabled={busy} />
      <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} className={field} placeholder="Кто это или что это" autoComplete="off" disabled={busy} />
      <button type="button" onClick={() => void add()} disabled={busy || !form.name_ru.trim()} className={`${primary} self-start`}>
        {busy ? "Добавляем…" : "Добавить"}
      </button>
    </section>
  );
}
