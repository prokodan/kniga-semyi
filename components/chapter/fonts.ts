// Шрифты главы и страницы голоса (I3): Noto Serif (кириллица/латиница) и Noto Serif KR — те же имена,
// что в токене --font-serif (app/globals.css). Файлы самохостятся из @fontsource и режутся по unicode-range:
// браузер скачивает только кусочки с нужными символами (для цитаты — несколько файлов по ~30–60 КБ).
// Без сети к Google Fonts при сборке; системный шрифт — пока грузится (font-display: swap), «квадратиков» нет.
import "@fontsource/noto-serif/400.css";
import "@fontsource/noto-serif-kr/400.css";
