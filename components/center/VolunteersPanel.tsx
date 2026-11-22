"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnCls, btnGhostCls, centerSend, inputCls } from "./ui";

export interface VolunteerItem {
  id: string;
  name: string;
  active: boolean;
  sessions: number;
  sessionsToday: number;
}

// Волонтёры киоска (kiosk_volunteers): добавить, отключить / вернуть. Отключённых нет в выборе на планшете.
export function VolunteersPanel({ volunteers }: { volunteers: VolunteerItem[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось. Попробуйте ещё раз.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 rounded-card bg-paper-deep p-4 shadow-card sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const n = name.trim();
          if (n.length < 2) return;
          if (await run("add", () => centerSend("/api/center/volunteers", "POST", { name: n }))) setName("");
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-ink-soft">Новый волонтёр</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя и фамилия" maxLength={80} />
        </label>
        <button type="submit" className={btnCls} disabled={busy !== null || name.trim().length < 2}>
          {busy === "add" ? "Добавляем…" : "Добавить"}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-card border border-danger bg-paper px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {volunteers.length === 0 ? (
        <p className="rounded-card bg-paper-deep p-5 text-center text-ink-soft">Волонтёров пока нет. Добавьте первого — он появится в выборе на планшете.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {volunteers.map((v) => (
            <li key={v.id} className={`flex items-center gap-3 rounded-card border border-line bg-paper p-3 ${v.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{v.name}</p>
                <p className="text-sm text-muted">
                  {v.active ? "на планшете" : "отключён"} · записей: {v.sessions}
                  {v.sessionsToday > 0 ? ` (сегодня ${v.sessionsToday})` : ""}
                </p>
              </div>
              <button
                type="button"
                className={btnGhostCls}
                disabled={busy !== null}
                onClick={() => void run(v.id, () => centerSend("/api/center/volunteers", "PATCH", { id: v.id, active: !v.active }))}
              >
                {busy === v.id ? "…" : v.active ? "Отключить" : "Вернуть"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
