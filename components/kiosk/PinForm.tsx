"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { kField, kioskPost, kPrimary } from "./ui";

// Вход волонтёра по PIN. Проверка — на сервере (/api/kiosk/login), неверный PIN — без подсказок.
export function PinForm() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    setError(null);
    try {
      await kioskPost("/api/kiosk/login", { pin });
      router.replace("/kiosk/queue");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN не подошёл");
      setPin("");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex w-full max-w-md flex-col gap-5">
      <label className="flex flex-col gap-2 text-elder text-ink-soft">
        PIN волонтёра
        <input
          className={`${kField} text-center font-serif text-4xl tracking-[0.4em]`}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
          required
        />
      </label>
      {error && (
        <p role="alert" className="rounded-card border border-danger/40 bg-paper p-4 text-center text-elder text-danger">
          {error}
        </p>
      )}
      <button type="submit" className={kPrimary} disabled={busy || !pin}>
        {busy ? "Проверяем…" : "Войти"}
      </button>
    </form>
  );
}
