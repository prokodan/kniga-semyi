"use client";
// #231 (флаг lang_kk): «Языки книги» на странице семьи — RU + KR / RU + KZ / только RU, одна цена.
// Сервер решает, показывать ли блок (флаг), и передаёт текущий выбор; сохранение — PATCH /api/families/<токен>/langs.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BOOK_LANG_CHOICES, type BookLangChoice } from "@/lib/pipeline/langs";

export function BookLangs({ token, current }: { token: string; current: BookLangChoice | null }) {
  const router = useRouter();
  const [value, setValue] = useState<BookLangChoice | null>(current);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function choose(id: BookLangChoice) {
    if (busy || id === value) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/families/${encodeURIComponent(token)}/langs`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ langs: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; queued?: number };
      if (!res.ok) throw new Error(data.message ?? "Не получилось сохранить. Попробуйте ещё раз.");
      setValue(id);
      setNote({
        ok: true,
        text: data.queued ? `Сохранено. Переводим готовые главы (${data.queued}) — это займёт несколько минут.` : "Сохранено.",
      });
      router.refresh();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Нет связи. Проверьте интернет и попробуйте ещё раз." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-paper p-4" aria-labelledby="book-langs">
      <h2 id="book-langs" className="font-serif text-xl">
        Языки книги
      </h2>
      <p className="text-sm text-ink-soft">Глава всегда по-русски, рядом — перевод. Цена одна для любого варианта.</p>
      <div role="radiogroup" aria-labelledby="book-langs" className="flex flex-col gap-2">
        {BOOK_LANG_CHOICES.map((c) => {
          const on = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => void choose(c.id)}
              className={`flex min-h-12 flex-col items-start rounded-card border px-4 py-3 text-left disabled:opacity-60 ${on ? "border-seal bg-paper-deep" : "border-line bg-paper"}`}
            >
              <span className="text-lg font-semibold">
                {on ? "✓ " : ""}
                {c.label}
              </span>
              <span className="text-sm text-muted">{c.hint}</span>
            </button>
          );
        })}
      </div>
      {note && <p className={`text-sm ${note.ok ? "text-jade" : "text-danger"}`}>{note.text}</p>}
    </section>
  );
}
