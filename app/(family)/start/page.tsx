import type { Metadata } from "next";
import { flag } from "@/lib/flags";
import { startDefaultPacks } from "@/lib/interview/start-choices";
import { StartForm } from "./StartForm";

export const metadata: Metadata = { title: "Создать книгу · Книга семьи" };

// Старт семьи: название книги, рассказчик (имя, годы, фото), дата вручения. ≤ 2 минут с телефона.
// #233 (флаг culture_packs): «Кто ваша семья?», язык рассказа, языки книги. #300: «По-казахски» — только с флагом spoken_kk.
// #301 (флаг culture_packs): отмечено заранее — по точке входа: ссылка АКНЦ `/start?pack=koryo` — корё-сарам (как сейчас),
// общая ссылка `/start` — ничего, семья выбирает сама; без корё-сарам — и без «우리 이야기» в шапке.
// #235: с древа («Записать историю мамы») приходят ?storyteller=&birthYear=&nameKo=&book= — поля заполнены заранее.
// #341: и пакеты / языки этой семьи: ?pack=<слой> (можно несколько), ?spoken=ru,koryo, ?langs=ru,ko — отмечено заранее
// (только варианты анкеты; чужое значение — как без него). Одна ссылка АКНЦ `?pack=koryo` — как было.
export default async function StartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (k: string) => {
    const v = q[k];
    return (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 120) || undefined;
  };
  const prefill = { name: one("book"), storytellerName: one("storyteller"), birthYear: one("birthYear")?.replace(/\D/g, "").slice(0, 4), storytellerNameKo: one("nameKo") };
  const second = Boolean(one("from"));
  const packsOn = flag("culture_packs");
  const packParams = [q.pack].flat().filter((v): v is string => typeof v === "string");
  const initialPacks = [...new Set(packParams.flatMap((p) => startDefaultPacks(p.trim())))];
  const initialSpoken = one("spoken") ?? null;
  const initialBook = one("langs") ?? null;
  const ko = !packsOn || initialPacks.includes("koryo");
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm tracking-widest text-muted uppercase">{ko ? "Книга семьи · 우리 이야기" : "Книга семьи"}</p>
        <h1 className="font-serif text-3xl leading-tight">Создадим книгу</h1>
        <p className="text-ink-soft">
          Пара строк о том, чьи рассказы будем записывать. Регистрация не нужна — в конце вы получите ссылку для всей семьи.
        </p>
        {second && <p className="rounded-card border border-gold bg-paper-deep px-4 py-3 text-ink-soft">Вторая книга в семье — со скидкой 40 %, древо в подарок.</p>}
      </header>
      <StartForm
        prefill={prefill}
        choices={packsOn ? { kkOn: flag("lang_kk"), spokenKkOn: flag("spoken_kk"), langChangeOn: flag("lang_change"), initialPacks, initialSpoken, initialBook } : null}
      />
    </main>
  );
}
