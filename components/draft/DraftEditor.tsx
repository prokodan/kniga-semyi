"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { diffDraft, DRAFT_LIMITS, DraftSchema, draftChanged, quoteMatch, type DraftFields, type DraftSaveResult } from "./draft";

// Форма правки главы: заголовок, цитата, текст RU. Сохранение — по кнопке и с подтверждением,
// потом «обновляем перевод» и переход в главу (там видно и RU, и обновлённый KR).
const field = "w-full rounded-card border border-line bg-paper px-4 py-3 text-lg text-ink placeholder:text-muted focus:border-ink focus:outline-none";
const label = "flex flex-col gap-1.5 text-ink-soft";

type Phase = "edit" | "confirm" | "saving" | "error";

export function DraftEditor({
  storyId,
  token,
  chapterUrl,
  initial,
  sources = [],
}: {
  storyId: string;
  token: string;
  chapterUrl: string;
  initial: DraftFields;
  /** Что говорил рассказчик (расшифровка): слова оттуда — не «новое» */
  sources?: string[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<DraftFields>(initial);
  const [form, setForm] = useState<DraftFields>(initial);
  const [phase, setPhase] = useState<Phase>("edit");
  const [message, setMessage] = useState<string | null>(null);

  const trimmed = useMemo(() => ({ title: form.title.trim(), quote: form.quote.trim(), text_ru: form.text_ru.trim() }), [form]);
  const check = DraftSchema.safeParse(trimmed);
  const problem = check.success ? null : check.error.issues[0]?.message ?? "Проверьте поля";
  const quote = quoteMatch(trimmed.quote, trimmed.text_ru);
  const quoteMissing = quote === "missing";
  const changed = draftChanged(saved, trimmed);
  // Чем правка отличается от сохранённого: написание — нейтрально, новое — предупреждение.
  const diff = useMemo(() => {
    const text = diffDraft(saved.text_ru, trimmed.text_ru, sources);
    const q = diffDraft(saved.quote, trimmed.quote, [...sources, saved.text_ru, trimmed.text_ru]);
    const t = diffDraft(saved.title, trimmed.title, [...sources, saved.text_ru, trimmed.text_ru]);
    return { spelling: [...text.spelling, ...q.spelling, ...t.spelling], added: [...text.added, ...q.added] };
  }, [saved, trimmed, sources]);
  const notes =
    changed && (diff.spelling.length > 0 || diff.added.length > 0 || quote === "spelling") ? (
      <div className="flex flex-col gap-2" aria-live="polite">
        {(diff.spelling.length > 0 || quote === "spelling") && (
          <p role="status" className="rounded-card bg-paper-deep px-4 py-3 text-sm text-ink-soft">
            ✓ Исправлено написание
            {diff.spelling.length > 0 ? `: ${diff.spelling.slice(0, 4).map((s) => `«${s.from}» → «${s.to}»`).join(", ")}` : ""}
          </p>
        )}
        {diff.added.length > 0 && (
          <p role="status" className="rounded-card bg-paper-deep px-4 py-3 text-sm text-warning">
            Новое в тексте: {diff.added.slice(0, 3).map((a) => `«${a}»`).join(", ")}. Рассказчик этого не говорил — проверьте, что глава
            остаётся его словами.
          </p>
        )}
      </div>
    ) : null;

  function set<K extends keyof DraftFields>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      if (phase !== "saving") setPhase("edit");
    };
  }

  async function save() {
    setPhase("saving");
    setMessage(null);
    try {
      const res = await fetch(`/api/stories/${storyId}/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-family-token": token },
        body: JSON.stringify(trimmed),
      });
      const data = (await res.json()) as DraftSaveResult & { error?: string; issues?: { message: string }[] };
      if (!res.ok) {
        setMessage(data.issues?.[0]?.message ?? data.message ?? "Не получилось сохранить. Попробуйте ещё раз.");
        setPhase("error");
        return;
      }
      setSaved(trimmed);
      // Глава покажет новый текст; если перевод ещё в работе — её экран ожидания сам его доведёт.
      router.push(chapterUrl);
      router.refresh();
    } catch {
      setMessage("Нет связи. Правки не потерялись — нажмите «Сохранить» ещё раз.");
      setPhase("error");
    }
  }

  const saving = phase === "saving";

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && changed) setPhase("confirm");
      }}
    >
      <label className={label}>
        Заголовок главы
        <input value={form.title} onChange={set("title")} maxLength={DRAFT_LIMITS.title} disabled={saving} className={field} autoComplete="off" />
      </label>

      <label className={label}>
        Цитата — главная фраза рассказчика
        <textarea
          value={form.quote}
          onChange={set("quote")}
          maxLength={DRAFT_LIMITS.quote}
          disabled={saving}
          rows={3}
          className={`${field} font-serif`}
          aria-describedby={quoteMissing ? "quote-warning" : undefined}
        />
        {quoteMissing && (
          <span id="quote-warning" role="status" className="rounded-card bg-paper-deep px-4 py-3 text-sm text-warning">
            Этой фразы нет в тексте главы. Цитата должна быть словами рассказчика — поправьте её так же, как в тексте.
          </span>
        )}
      </label>

      <label className={label}>
        Текст главы
        <textarea
          value={form.text_ru}
          onChange={set("text_ru")}
          maxLength={DRAFT_LIMITS.text_ru}
          disabled={saving}
          rows={14}
          className={`${field} min-h-[50vh] font-serif leading-relaxed`}
        />
      </label>

      {phase !== "confirm" && notes}

      {problem && <p className="text-danger">{problem}</p>}
      {phase === "error" && message && (
        <p role="alert" className="text-danger">
          {message}
        </p>
      )}

      {phase === "confirm" ? (
        <section className="flex flex-col gap-3 rounded-card bg-paper-deep p-5 shadow-card" aria-live="polite">
          <p className="text-elder">Сохранить правки?</p>
          <p className="text-ink-soft">Корейский перевод соберётся заново — это займёт до минуты.</p>
          {notes}
          {quoteMissing && <p className="text-warning">Цитаты нет в тексте — всё равно сохранить?</p>}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => void save()} className="rounded-button bg-seal px-6 py-4 text-lg font-semibold text-paper">
              Да, сохранить
            </button>
            <button type="button" onClick={() => setPhase("edit")} className="rounded-button border border-line px-6 py-4 text-lg text-ink">
              Ещё поправлю
            </button>
          </div>
        </section>
      ) : saving ? (
        <section className="flex items-center gap-3 rounded-card bg-paper-deep p-5 shadow-card" aria-live="polite">
          <span aria-hidden className="size-4 shrink-0 animate-pulse rounded-full bg-seal" />
          <p className="text-elder">Сохранили — обновляем перевод…</p>
        </section>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={Boolean(problem) || !changed}
            className="rounded-button bg-seal px-6 py-4 text-lg font-semibold text-paper disabled:opacity-50"
          >
            Сохранить
          </button>
          <Link href={chapterUrl} className="button inline-flex items-center justify-center rounded-button border border-line px-6 py-4 text-lg text-ink">
            {changed ? "Отменить" : "К главе"}
          </Link>
        </div>
      )}
    </form>
  );
}
