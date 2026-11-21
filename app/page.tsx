import Link from "next/link";

// Временная главная. Экран «Старт семьи» делает I1 в app/(family)/.
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
      <div className="rounded-card bg-paper-deep p-5 shadow-card">
        <p className="text-sm text-muted">Каркас W0 готов. Экраны появятся по задачам I1–I15.</p>
        <Link href="/api/health" className="mt-2 inline-block text-seal underline underline-offset-4">
          Проверить /api/health
        </Link>
      </div>
    </main>
  );
}
