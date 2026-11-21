import Link from "next/link";

// Главная: вход в «Старт семьи» (I1). Лендинг для комиссии — позже.
export default function Home() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
      <p className="text-sm tracking-widest text-muted uppercase">Startup-Nunchi · MLP</p>
      <h1 className="font-serif text-4xl leading-tight">
        Книга семьи
        <span className="block text-2xl text-ink-soft">우리 이야기</span>
      </h1>
      <p className="text-elder text-ink-soft">
        Запишите голос бабушки или дедушки — мы превратим рассказы в главы на русском и корейском и соберём книгу для
        внуков.
      </p>
      <Link
        href="/start"
        className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark"
      >
        Создать книгу семьи
      </Link>
      <p className="text-sm text-muted">Без регистрации: в конце вы получите ссылку для всей семьи.</p>
    </main>
  );
}
