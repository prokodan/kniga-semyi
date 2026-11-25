"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const primary = "button flex min-h-12 items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark disabled:opacity-60";
const secondary = "button flex min-h-12 items-center justify-center rounded-button border border-line bg-paper px-6 py-3 font-semibold text-ink";

// Кнопки экрана книги: «Собрать / пересобрать» (POST /api/books/:id/build) и «Открыть / скачать PDF».
export function BookActions({
  familyId,
  token,
  hasPdf,
  building,
  canBuild,
}: {
  familyId: string;
  token: string;
  hasPdf: boolean;
  building: boolean;
  canBuild: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(building);
  const [message, setMessage] = useState<string | null>(null);
  const pdf = `/api/books/${familyId}/pdf?token=${encodeURIComponent(token)}`;

  async function build() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/books/${familyId}/build`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-token": token },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string | null };
      if (!res.ok) setMessage(data.message ?? "Не получилось собрать книгу. Попробуйте ещё раз через минуту.");
    } catch {
      setMessage("Нет связи. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {hasPdf && (
        <>
          <a href={pdf} target="_blank" rel="noopener" className={primary}>
            Открыть книгу (PDF)
          </a>
          <a href={`${pdf}&download=1`} className={secondary}>
            Скачать PDF
          </a>
        </>
      )}
      <button type="button" onClick={build} disabled={busy || !canBuild} className={hasPdf ? secondary : primary}>
        {busy ? "Собираем книгу… обычно до 20 секунд" : hasPdf ? "Пересобрать с новыми главами" : "Собрать книгу"}
      </button>
      {message && (
        <p role="alert" className="text-center text-danger">
          {message}
        </p>
      )}
    </div>
  );
}
