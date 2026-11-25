// Неверная или обрезанная подпись QR — тёплая 404 без подробностей (не раскрываем, есть ли история).
export default function ListenNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
      <p className="text-xs tracking-[0.25em] text-muted uppercase">
        Книга семьи · <span lang="ko">우리 이야기</span>
      </p>
      <h1 className="font-serif text-3xl">Запись не найдена</h1>
      <p className="text-elder text-ink-soft">Похоже, QR-код отсканировался не целиком. Наведите камеру ещё раз — спокойно, на пару секунд.</p>
    </main>
  );
}
