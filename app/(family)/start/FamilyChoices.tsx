"use client";
// #233 (флаг culture_packs): «Кто ваша семья?» (несколько слоёв или «просто общие вопросы»), «На каком языке удобнее
// рассказывать?», «На каких языках книга?». Поля уходят в POST /api/families: packs (несколько), spoken, book.
// По умолчанию — корё-сарам, по-русски с корё мар, книга RU + KR = сегодняшний продукт. Пока семья сама не выбрала
// язык рассказа и книги, они следуют за выбором пакетов (казахская → книга RU + KZ).
import { useState } from "react";
import { GENERAL_CHOICE, START_DEFAULT_PACKS, bookChoices, defaultsFor, packChoices, spokenChoices, type Choice } from "@/lib/interview/start-choices";

const box = "flex min-h-12 cursor-pointer items-center gap-3 rounded-card border border-line bg-paper px-4 py-3 text-lg text-ink has-[:checked]:border-ink";
const mark = "size-5 shrink-0 accent-seal";

function Hint({ c }: { c: Choice }) {
  return c.hint ? <span className="block text-sm text-muted">{c.hint}</span> : null;
}

/** `onPacks` — форма прячет «Имя по-корейски», когда корё-сарам не выбраны. */
export function FamilyChoices({ kkOn, onPacks }: { kkOn: boolean; onPacks?: (packs: string[]) => void }) {
  const layers = packChoices();
  const [packs, setPacksState] = useState<string[]>(START_DEFAULT_PACKS);
  const setPacks = (v: string[]) => {
    setPacksState(v);
    onPacks?.(v);
  };
  const [spoken, setSpoken] = useState<string | null>(null);
  const [book, setBook] = useState<string | null>(null);

  const general = packs.length === 0;
  const effective = general ? ["general"] : packs;
  const defaults = defaultsFor(effective, kkOn);
  const spokenOpts = spokenChoices(effective);
  const bookOpts = bookChoices(kkOn);
  // выбор семьи, если он ещё уместен для пакетов; иначе — предложение по умолчанию
  const spokenValue = spoken && spokenOpts.some((c) => c.id === spoken) ? spoken : defaults.spoken;
  const bookValue = book && bookOpts.some((c) => c.id === book) ? book : defaults.book;

  function toggle(id: string) {
    setPacks(packs.includes(id) ? packs.filter((p) => p !== id) : [...packs, id]);
  }

  return (
    <fieldset className="flex flex-col gap-5 rounded-card bg-paper-deep p-4">
      <legend className="px-1 font-serif text-xl text-ink">Кто ваша семья</legend>
      <p className="-mt-2 text-ink-soft">Подстроим вопросы под традиции вашей семьи. Можно выбрать несколько.</p>

      <div className="flex flex-col gap-2" role="group" aria-label="Кто ваша семья">
        {layers.map((c) => (
          <label key={c.id} className={box}>
            <input type="checkbox" name="packs" value={c.id} checked={packs.includes(c.id)} onChange={() => toggle(c.id)} className={mark} />
            <span>{c.label}</span>
          </label>
        ))}
        <label className={box}>
          <input type="checkbox" name="packs" value="general" checked={general} onChange={() => setPacks(general ? START_DEFAULT_PACKS : [])} className={mark} />
          <span>
            {GENERAL_CHOICE.label}
            <Hint c={GENERAL_CHOICE} />
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2" role="radiogroup" aria-label="На каком языке удобнее рассказывать">
        <p className="text-ink-soft">На каком языке удобнее рассказывать?</p>
        {spokenOpts.map((c) => (
          <label key={c.id} className={box}>
            <input type="radio" name="spoken" value={c.id} checked={spokenValue === c.id} onChange={() => setSpoken(c.id)} className={mark} />
            <span>
              {c.label}
              <Hint c={c} />
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-2" role="radiogroup" aria-label="На каких языках книга">
        <p className="text-ink-soft">На каких языках будет книга?</p>
        {bookOpts.map((c) => (
          <label key={c.id} className={box}>
            <input type="radio" name="book" value={c.id} checked={bookValue === c.id} onChange={() => setBook(c.id)} className={mark} />
            <span>
              {c.label}
              <Hint c={c} />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
