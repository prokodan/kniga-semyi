"use client";
// #232: форма «Новая ссылка» — пара, режим, набор, инициалы, срок. Готовая ссылка показывается один раз (в базе — хэш).
import { useActionState, useMemo, useState } from "react";
import { btnCls, inputCls } from "@/components/admin/ui";
import { createLinkAction, type CreateState } from "./actions";

export interface SetOption {
  id: string;
  label: string;
  mode: "texts" | "questions";
  pair: string;
  count: number;
}

const PAIRS = [
  { id: "ru-ko", label: "ru → ko (корейский)" },
  { id: "ru-kk", label: "ru → kk (казахский)" },
];

export function CreateLinkForm({ sets }: { sets: SetOption[] }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(createLinkAction, { kind: "idle" });
  const [pair, setPair] = useState("ru-ko");
  const [mode, setMode] = useState<"texts" | "questions">("texts");
  const options = useMemo(() => sets.filter((s) => s.pair === pair && s.mode === mode), [sets, pair, mode]);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Языковая пара
          <select name="pair" className={inputCls} value={pair} onChange={(e) => setPair(e.target.value)}>
            {PAIRS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Что проверяем
          <select name="mode" className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "texts" | "questions")}>
            <option value="texts">Тексты глав (оригинал | перевод)</option>
            <option value="questions">Вопросы банка</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Набор (только вымышленные тексты)
          <select name="set" className={inputCls} key={`${pair}-${mode}`} defaultValue={options.find((o) => o.count > 0)?.id}>
            {options.map((o) => (
              <option key={o.id} value={o.id} disabled={o.count === 0}>
                {o.label} — {o.count ? `${o.count} текстов` : "для пары пока нет текстов"}
              </option>
            ))}
            {options.length === 0 ? <option value="">Наборов для пары пока нет</option> : null}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Проверяющий — только инициалы
          <input name="reviewer" className={inputCls} placeholder="А. К." maxLength={40} required autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Срок, дней
          <input name="days" type="number" min={1} max={90} defaultValue={14} className={inputCls} />
        </label>
        <button type="submit" className={btnCls} disabled={pending || !options.some((o) => o.count > 0)}>
          {pending ? "Создаю…" : "Создать ссылку"}
        </button>
      </form>
      {state.kind === "err" ? (
        <p className="rounded-card bg-paper-deep p-3 text-sm text-danger" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "ok" ? (
        <div className="flex flex-col gap-2 rounded-card border border-jade bg-paper p-3 text-sm" data-testid="review-new-link">
          <p>
            Ссылка для {state.label} ({state.pair}, текстов: {state.items}). Покажется <b>один раз</b> — скопируйте и отправьте носителю лично
            (не в общие чаты, не в PR).
          </p>
          <a href={state.url} className="break-all text-seal underline" target="_blank" rel="noreferrer noopener">
            {state.url}
          </a>
          <button
            type="button"
            className={btnCls}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.url);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Скопировано ✓" : "Скопировать ссылку"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
