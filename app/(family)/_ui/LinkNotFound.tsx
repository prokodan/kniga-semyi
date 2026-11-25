import Link from "next/link";

// Неверная или устаревшая ссылка семьи — тёплая страница вместо 500.
export function LinkNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-6 py-12">
      <h1 className="font-serif text-3xl">Ссылка не открылась</h1>
      <p className="text-elder text-ink-soft">
        Похоже, ссылка на книгу неполная или в ней опечатка. Откройте её ещё раз из сообщения — целиком, вместе с длинным
        кодом в конце.
      </p>
      <p className="text-ink-soft">Если книги ещё нет — её можно создать за пару минут.</p>
      <Link href="/start" className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-lg font-semibold text-paper">
        Создать книгу семьи
      </Link>
    </main>
  );
}
