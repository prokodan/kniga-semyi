// Текст голосового согласия. Обязательная фраза: запись обрабатывают внешние ИИ-сервисы.
// #299: про перевод — по языкам книги семьи (RU + KR — как было, RU + KZ — «на казахский», только RU — без перевода).
// #306: книга с докупленным языком — «на корейский и казахский»; один перевод — строка байт в байт как до #306.
import { LANG_UI, langUi, type SecondLang } from "@/lib/pipeline/langs";
import { DEFAULT_BOOK_LANGS, type BookLang } from "@/lib/types";

/** «на корейский» / «на корейский и казахский»; null — перевода нет. */
function translationTo(langs: readonly BookLang[]): string | null {
  const ui = langUi(langs);
  if (!ui) return null;
  const all = langs.filter((l): l is SecondLang => l !== "ru");
  if (all.length < 2) return ui.to;
  return `на ${all.map((l) => LANG_UI[l].name).join(" и ")}`;
}

/** Текст согласия. Рассказчик произносит его вслух — запись хранится в bucket audio. */
export function consentText(name: string, langs: readonly BookLang[] = DEFAULT_BOOK_LANGS) {
  const to = translationTo(langs);
  return (
    `Я, ${name}, согласен (согласна), чтобы мои рассказы записывали для книги нашей семьи. ` +
    "Я знаю, что запись голоса обрабатывают внешние сервисы искусственного интеллекта — они переводят речь в текст" +
    (to ? ` и помогают с переводом ${to}.` : ".") +
    " Записи и книгу видит только наша семья."
  );
}
