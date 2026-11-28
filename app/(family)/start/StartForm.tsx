"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { START_DEFAULT_PACKS } from "@/lib/interview/start-choices";
import { FamilyChoices } from "./FamilyChoices";

const MAX_SIDE = 1280;

/** Ужать фото в браузере до JPEG ≤ 1280 px (~200–400 КБ) — iPhone отдаёт HEIC по 3–5 МБ. */
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

const field = "w-full rounded-card border border-line bg-paper px-4 py-3 text-lg text-ink placeholder:text-muted focus:border-ink focus:outline-none";
const label = "flex flex-col gap-1.5 text-ink-soft";

export interface StartPrefill {
  name?: string;
  storytellerName?: string;
  birthYear?: string;
  storytellerNameKo?: string;
}

/** #233: анкета «Кто ваша семья?» — только с флагом culture_packs (null — формы нет, семья получает умолчания). */
/** #301: `choices.initialPacks` — отмечено заранее по точке входа ([] — общая ссылка). #306: `langChangeOn` — флаг lang_change. */
export function StartForm({
  prefill = {},
  choices = null,
}: {
  prefill?: StartPrefill;
  choices?: { kkOn: boolean; spokenKkOn?: boolean; langChangeOn?: boolean; initialPacks?: string[] } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  // #233: «Имя по-корейски» — без анкеты (флаг выключен) всегда, с анкетой — когда выбраны корё-сарам
  const [packs, setPacks] = useState<string[]>(choices?.initialPacks ?? START_DEFAULT_PACKS);
  const showKo = !choices || packs.includes("koryo");

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPhotoNote(null);
    if (!file) return;
    try {
      const blob = await shrinkPhoto(file);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
    } catch {
      if (file.size <= 3.5 * 1024 * 1024 && file.type.startsWith("image/")) {
        setPhoto({ blob: file, preview: URL.createObjectURL(file) });
      } else {
        setPhoto(null);
        setPhotoNote("Это фото не получилось открыть. Можно выбрать другое или добавить позже.");
      }
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    form.delete("photoFile");
    if (photo) form.set("photo", photo.blob, "photo.jpg");
    try {
      const res = await fetch("/api/families", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message ?? "Не получилось создать книгу. Попробуйте ещё раз.");
      router.push(`${data.url}?new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось создать книгу. Попробуйте ещё раз.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
      <label className={label}>
        Как назовём книгу?
        <input name="name" defaultValue={prefill.name} required maxLength={120} className={field} placeholder="Например: Книга семьи Ким" autoComplete="off" />
      </label>

      <fieldset className="flex flex-col gap-4 rounded-card bg-paper-deep p-4">
        <legend className="px-1 font-serif text-xl text-ink">Кто будет рассказывать</legend>
        <label className={label}>
          Имя, как зовут в семье
          <input name="storytellerName" defaultValue={prefill.storytellerName} required maxLength={120} className={field} placeholder="Бабушка Мария" autoComplete="off" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Год рождения
            <input name="birthYear" defaultValue={prefill.birthYear} inputMode="numeric" pattern="(19|20)[0-9]{2}" maxLength={4} className={field} placeholder="1941" />
          </label>
          <label className={label}>
            Где родились
            <input name="birthPlace" maxLength={160} className={field} placeholder="Уштобе" />
          </label>
        </div>
        {showKo && (
          <label className={label}>
            Имя по-корейски <span className="text-sm text-muted">(если есть, можно пропустить)</span>
            <input name="storytellerNameKo" defaultValue={prefill.storytellerNameKo} maxLength={120} className={field} placeholder="김마리아" lang="ko" />
          </label>
        )}
        <div className="flex items-center gap-4">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- локальное превью blob:, next/image не нужен
            <img src={photo.preview} alt="Фото рассказчика" className="size-20 rounded-card object-cover" />
          ) : (
            <div aria-hidden className="flex size-20 items-center justify-center rounded-card border border-dashed border-line text-3xl text-muted">
              ☺
            </div>
          )}
          <label className="flex-1 cursor-pointer rounded-button border border-line bg-paper px-4 py-3 text-center">
            {photo ? "Другое фото" : "Добавить фото"}
            <input name="photoFile" type="file" accept="image/*" className="hidden" onChange={(e) => void onPhoto(e)} />
          </label>
        </div>
        {photoNote && <p className="text-sm text-warning">{photoNote}</p>}
      </fieldset>

      {choices && (
        <FamilyChoices
          kkOn={choices.kkOn}
          spokenKkOn={choices.spokenKkOn}
          langChangeOn={choices.langChangeOn}
          initialPacks={choices.initialPacks}
          onPacks={setPacks}
        />
      )}

      <label className={label}>
        Когда хотите подарить книгу? <span className="text-sm text-muted">(можно пропустить)</span>
        <input name="giftDate" type="date" className={field} />
      </label>

      {error && <p className="rounded-card border border-danger/40 bg-paper p-4 text-danger">{error}</p>}

      <button type="submit" disabled={busy} className="rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark disabled:opacity-60">
        {busy ? "Создаём книгу…" : "Создать книгу"}
      </button>
    </form>
  );
}
