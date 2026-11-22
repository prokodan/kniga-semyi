"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnCls, centerSend, inputCls } from "./ui";

// Вход в кабинет АКНЦ по ADMIN_PIN. Проверка — на сервере (/api/center/login).
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
      await centerSend("/api/center/login", "POST", { pin });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN не подошёл");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-card bg-paper-deep p-5 shadow-card">
      <label className="flex flex-col gap-1">
        <span className="text-ink-soft">PIN администратора</span>
        <input
          className={`${inputCls} text-center tracking-[0.3em]`}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
          required
        />
      </label>
      {error && (
        <p role="alert" className="rounded-card border border-danger bg-paper px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" className={btnCls} disabled={busy || !pin}>
        {busy ? "Проверяем…" : "Войти"}
      </button>
    </form>
  );
}
