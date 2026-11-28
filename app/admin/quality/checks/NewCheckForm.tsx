"use client";
// #353: «Новая ссылка» — пара → проверяющий (имя, язык интерфейса) → что проверять (текст / слова) → материал
// (галочки, фильтр по тегам) → срок → ссылка + QR. Ссылка показывается один раз (в базе — хэш токена).
import { useActionState, useMemo, useState } from "react";
import { btnCls, btnGhostCls, inputCls } from "@/components/admin/ui";
import { TERMS_MIN, estimateMinutes, type CheckKind, type UiLang } from "./_lib/core";
import { createCheckAction, type CreateCheckState } from "./actions";

export interface MaterialOption {
  id: string;
  pair: string;
  originLabel: string;
  title: string | null;
  persona: string;
  tags: string[];
  terms: string[];
  words: number;
  preview: string;
}

const PAIRS = [
  { id: "ru-ko", label: "ru → ko", hint: "корейский", ui: "ko" as UiLang },
  { id: "ru-kk", label: "ru → kk", hint: "казахский", ui: "kk" as UiLang },
];
const UI: { id: UiLang; label: string }[] = [
  { id: "ko", label: "한국어 + русский" },
  { id: "kk", label: "Қазақша + русский" },
  { id: "ru", label: "Только русский" },
];

const step = "flex flex-col gap-2 rounded-card border border-line bg-paper p-3";
const stepTitle = "flex items-center gap-2 font-medium";
const num = "flex size-7 shrink-0 items-center justify-center rounded-button bg-ink text-sm text-paper";
const chip = "min-h-10 rounded-button border px-3 text-sm";

export function NewCheckForm({ materials, tagsByPair }: { materials: MaterialOption[]; tagsByPair: Record<string, string[]> }) {
  const [state, action, pending] = useActionState<CreateCheckState, FormData>(createCheckAction, { kind: "idle" });
  const [pair, setPair] = useState("ru-ko");
  const [ui, setUi] = useState<UiLang>("ko");
  const [kind, setKind] = useState<CheckKind>("text");
  const [tags, setTags] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const ofPair = useMemo(() => materials.filter((m) => m.pair === pair), [materials, pair]);
  const visible = useMemo(() => ofPair.filter((m) => tags.every((t) => m.tags.includes(t))), [ofPair, tags]);
  const fits = (m: MaterialOption) => kind === "text" || m.terms.length >= TERMS_MIN;
  const chosen = picked.filter((id) => ofPair.some((m) => m.id === id && fits(m)));
  const [lo, hi] = estimateMinutes(kind, chosen.length || 1);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  if (state.kind === "ok") {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-success bg-paper p-4" data-testid="check-created">
        <p>
          Ссылка для <b>{state.label}</b> · {state.pair} · {state.mode === "terms" ? "слова" : "текст"} · текстов: {state.items}. Показываем один раз —
          скопируйте или покажите QR.
        </p>
        <p className="font-mono text-sm break-all" data-testid="check-url">
          {state.url}
        </p>
        <div className="mx-auto w-56 text-ink" dangerouslySetInnerHTML={{ __html: state.qr }} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnCls}
            onClick={() => {
              void navigator.clipboard?.writeText(state.url).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Скопировано ✓" : "Скопировать"}
          </button>
          <a className={`${btnGhostCls} flex items-center`} href={state.url} target="_blank" rel="noreferrer">
            Открыть
          </a>
          <button type="button" className={btnGhostCls} onClick={() => window.location.reload()}>
            Ещё ссылку
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className={step}>
        <legend className={stepTitle}>
          <span className={num}>1</span> Пара
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {PAIRS.map((p) => (
            <label key={p.id} className={`${chip} flex min-h-12 items-center gap-2 ${pair === p.id ? "border-ink bg-paper-deep" : "border-line"}`}>
              <input
                type="radio"
                name="pair"
                value={p.id}
                checked={pair === p.id}
                onChange={() => {
                  setPair(p.id);
                  setUi(p.ui);
                  setTags([]);
                }}
              />
              <span>
                {p.label} <span className="text-muted">· {p.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={step}>
        <legend className={stepTitle}>
          <span className={num}>2</span> Проверяющий
        </legend>
        <label className="flex flex-col gap-1 text-sm">
          Имя (сохраним только инициалы)
          <input name="reviewer" className={inputCls} placeholder="Айгерим К." maxLength={40} required autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Язык интерфейса
          <select name="ui_lang" className={inputCls} value={ui} onChange={(e) => setUi(e.target.value as UiLang)}>
            {UI.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className={step}>
        <legend className={stepTitle}>
          <span className={num}>3</span> Что проверять
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["text", "Текст целиком", "абзацы, правка, 5 критериев"],
              ["terms", "Только выделенные слова", "3–8 слов: верно / неверно"],
            ] as const
          ).map(([id, label, hint]) => (
            <label key={id} className={`${chip} flex min-h-12 items-center gap-2 py-2 ${kind === id ? "border-ink bg-paper-deep" : "border-line"}`}>
              <input type="radio" name="kind" value={id} checked={kind === id} onChange={() => setKind(id)} />
              <span>
                {label}
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={step}>
        <legend className={stepTitle}>
          <span className={num}>4</span> Материал
        </legend>
        <div className="flex flex-wrap gap-2" aria-label="Фильтр по тегам">
          {(tagsByPair[pair] ?? []).map((t) => {
            const on = tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                className={`${chip} ${on ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
                onClick={() => setTags((x) => (on ? x.filter((y) => y !== t) : [...x, t]))}
              >
                {t}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className={btnGhostCls} onClick={() => setPicked((p) => [...new Set([...p, ...visible.filter(fits).map((m) => m.id)])])}>
            Отметить видимые
          </button>
          <button type="button" className={btnGhostCls} onClick={() => setPicked([])}>
            Снять все
          </button>
          <span className="text-ink-soft" data-testid="check-picked">
            Отмечено {chosen.length} · ≈ {lo}–{hi} мин
          </span>
        </div>
        {visible.length === 0 ? <p className="text-ink-soft">Под фильтр ничего не подходит.</p> : null}
        <ul className="flex flex-col gap-2">
          {visible.map((m) => {
            const ok = fits(m);
            const on = picked.includes(m.id) && ok;
            return (
              <li key={m.id}>
                <label
                  className={`flex gap-3 rounded-card border p-3 ${on ? "border-ink bg-paper-deep" : "border-line"} ${ok ? "" : "opacity-60"}`}
                  data-material={m.id}
                >
                  <input type="checkbox" className="mt-1 size-5 shrink-0" checked={on} disabled={!ok} onChange={() => toggle(m.id)} aria-label={m.title ?? m.id} />
                  <span className="flex min-w-0 flex-col gap-1 text-sm">
                    <span className="font-medium">
                      {m.title ?? "Без названия"} <span className="font-normal text-muted">· {m.persona} · {m.originLabel} · {m.words} сл.</span>
                    </span>
                    <span className="line-clamp-2 text-ink-soft">{m.preview}</span>
                    {kind === "terms" ? (
                      <span className="flex flex-wrap gap-1">
                        {m.terms.length ? (
                          m.terms.map((t) => (
                            <span key={t} className="rounded-button bg-gold/20 px-2 py-0.5">
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted">слов для проверки не нашлось</span>
                        )}
                        {!ok && m.terms.length ? <span className="text-muted">— нужно ≥ {TERMS_MIN}</span> : null}
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-1 text-xs text-muted">
                        {m.tags
                          .filter((t) => !t.startsWith("персонаж"))
                          .map((t) => (
                            <span key={t} className="rounded-button border border-line px-2 py-0.5">
                              {t}
                            </span>
                          ))}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {chosen.map((id) => (
          <input key={id} type="hidden" name="item" value={id} />
        ))}
      </fieldset>

      <fieldset className={step}>
        <legend className={stepTitle}>
          <span className={num}>5</span> Срок
        </legend>
        <select name="days" className={inputCls} defaultValue="14" aria-label="Срок ссылки">
          <option value="3">3 дня</option>
          <option value="7">7 дней</option>
          <option value="14">14 дней</option>
          <option value="30">30 дней</option>
        </select>
      </fieldset>

      {state.kind === "err" ? (
        <p className="text-danger" role="alert">
          {state.message}
        </p>
      ) : null}
      <button type="submit" className={btnCls} disabled={pending || chosen.length === 0}>
        {pending ? "Создаю…" : `Создать ссылку · текстов: ${chosen.length}`}
      </button>
    </form>
  );
}
