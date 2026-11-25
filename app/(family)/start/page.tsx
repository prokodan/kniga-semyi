import type { Metadata } from "next";
import { StartForm } from "./StartForm";

export const metadata: Metadata = { title: "Создать книгу · Книга семьи" };

// Старт семьи: название книги, рассказчик (имя, годы, фото), дата вручения. ≤ 2 минут с телефона.
export default function StartPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm tracking-widest text-muted uppercase">Книга семьи · 우리 이야기</p>
        <h1 className="font-serif text-3xl leading-tight">Создадим книгу</h1>
        <p className="text-ink-soft">
          Пара строк о том, чьи рассказы будем записывать. Регистрация не нужна — в конце вы получите ссылку для всей семьи.
        </p>
      </header>
      <StartForm />
    </main>
  );
}
