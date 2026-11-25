// Цитата главы крупно: «…» киноварью, текст засечками. Корейский — без разрыва слов (break-keep).
export function Quote({ text, lang, size = "lg" }: { text: string | null; lang: "ru" | "ko"; size?: "lg" | "md" }) {
  if (!text) return null;
  const clean = text.replace(/^[«"“„]+|[»"”]+$/g, "").trim();
  return (
    <blockquote lang={lang} className="relative border-l-4 border-seal py-1 pl-5">
      <p
        className={`font-serif text-ink ${size === "lg" ? "text-2xl leading-snug md:text-[1.75rem]" : "text-xl leading-snug"} ${
          lang === "ko" ? "break-keep" : ""
        }`}
      >
        <span aria-hidden className="text-seal">«</span>
        {clean}
        <span aria-hidden className="text-seal">»</span>
      </p>
    </blockquote>
  );
}
