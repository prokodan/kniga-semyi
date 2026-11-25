"use client";
// Карточка старейшины: имя, годы, место, фото с камеры планшета, кто из волонтёров ведёт запись.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { kField, kGhost, kLabel, kPrimary } from "./ui";

const MAX_SIDE = 1280;

/** Ужать снимок до JPEG ≤ 1280 px — камера планшета отдаёт 3–8 МБ. */
async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob) throw new Error("toBlob");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ElderForm({ volunteers, currentVolunteerId }: { volunteers: { id: string; name: string }[]; currentVolunteerId: string | null }) {
  const router = useRouter();
  const [volunteerId, setVolunteerId] = useState<string | null>(
    currentVolunteerId && volunteers.some((v) => v.id === currentVolunteerId) ? currentVolunteerId : null,
  );
  const [newVolunteer, setNewVolunteer] = useState(volunteers.length === 0);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setPhotoNote(null);
    if (!file) return;
    try {
      const blob = await shrinkPhoto(file);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
    } catch {
      if (file.type.startsWith("image/") && file.size <= 3.5 * 1024 * 1024) setPhoto({ blob: file, preview: URL.createObjectURL(file) });
      else setPhotoNote("Снимок не открылся. Сделайте ещё раз или продолжите без фото.");
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    form.delete("photoFile");
    if (photo) form.set("photo", photo.blob, "photo.jpg");
    if (newVolunteer) form.delete("volunteerId");
    else if (volunteerId) form.set("volunteerId", volunteerId);
    if (!newVolunteer && !volunteerId) {
      setError("Выберите, кто из волонтёров ведёт запись");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kiosk/families", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (res.status === 401) return router.replace("/kiosk");
      if (!res.ok || !data.url) throw new Error(data.message ?? "Не получилось сохранить карточку. Попробуйте ещё раз.");
      router.push(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось сохранить карточку. Попробуйте ещё раз.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-5">
        <label className={kLabel}>
          Как зовут старейшину
          <input name="name" required maxLength={120} className={kField} placeholder="Ким Мария Петровна" autoComplete="off" />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className={kLabel}>
            Год рождения
            <input name="birthYear" inputMode="numeric" pattern="(19|20)[0-9]{2}" maxLength={4} className={kField} placeholder="1941" />
          </label>
          <label className={kLabel}>
            Где родились
            <input name="birthPlace" maxLength={160} className={kField} placeholder="Уштобе" />
          </label>
        </div>
        <label className={kLabel}>
          <span>
            Имя по-корейски <span className="text-muted">(если есть)</span>
          </span>
          <input name="nameKo" maxLength={120} className={kField} placeholder="김마리아" lang="ko" />
        </label>

        <fieldset className="flex flex-col gap-3 rounded-card bg-paper-deep p-5">
          <legend className="px-1 text-elder text-ink">Кто ведёт запись</legend>
          {!newVolunteer && (
            <div className="flex flex-wrap gap-3">
              {volunteers.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={volunteerId === v.id}
                  onClick={() => setVolunteerId(v.id)}
                  className={volunteerId === v.id ? kPrimary : kGhost}
                >
                  {volunteerId === v.id ? "✓ " : ""}
                  {v.name}
                </button>
              ))}
              <button type="button" onClick={() => setNewVolunteer(true)} className={kGhost}>
                + Я новый волонтёр
              </button>
            </div>
          )}
          {newVolunteer && (
            <div className="flex flex-col gap-3">
              <input name="volunteerName" required minLength={2} maxLength={80} className={kField} placeholder="Ваше имя" autoComplete="off" />
              {volunteers.length > 0 && (
                <button type="button" onClick={() => setNewVolunteer(false)} className="min-h-12 self-start text-ink-soft underline underline-offset-4">
                  Выбрать из списка
                </button>
              )}
            </div>
          )}
        </fieldset>
      </div>

      <div className="flex flex-col gap-4">
        <div className="mx-auto flex aspect-square w-full max-w-60 items-center lg:max-w-none justify-center overflow-hidden rounded-card border border-dashed border-line bg-paper-deep">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- локальное превью blob:, next/image не нужен
            <img src={photo.preview} alt="Фото старейшины" className="size-full object-cover" />
          ) : (
            <span aria-hidden className="text-7xl text-muted">
              ☺
            </span>
          )}
        </div>
        <label className={`${kGhost} cursor-pointer`}>
          📷 {photo ? "Переснять" : "Сфотографировать"}
          <input name="photoFile" type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => void onPhoto(e)} />
        </label>
        {photoNote && <p className="text-warning">{photoNote}</p>}
        <p className="text-sm text-muted">Фото попадёт на обложку книги. Можно без фото.</p>
      </div>

      {error && <p className="rounded-card border border-danger/40 bg-paper p-4 text-elder text-danger lg:col-span-2">{error}</p>}
      <button type="submit" disabled={busy} className={`${kPrimary} lg:col-span-2`}>
        {busy ? "Сохраняем…" : "Дальше — согласие и запись"}
      </button>
    </form>
  );
}
