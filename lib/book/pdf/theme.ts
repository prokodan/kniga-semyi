// Оформление PDF. Цвета — те же значения, что токены app/globals.css (@theme): в PDF нет Tailwind,
// поэтому значения продублированы здесь; новых цветов не вводим.
export const COLOR = {
  paper: "#fbf7f0", // --color-paper
  paperDeep: "#f2eadc", // --color-paper-deep
  ink: "#2b2420", // --color-ink
  inkSoft: "#4a403a", // --color-ink-soft
  muted: "#8a7f76", // --color-muted
  line: "#e3d8c8", // --color-line
  seal: "#b8402f", // --color-seal
  gold: "#b88a3e", // --color-gold
} as const;

/**
 * A5 = 148 × 210 мм = 420 × 595 pt. Поля под печать ≥ 16 мм со всех сторон (запас под переплёт и обрез;
 * зеркальные поля react-pdf в потоковом тексте не умеет — берём симметричные с запасом).
 */
export const PAGE = {
  size: "A5" as const,
  top: 58, // 20,5 мм, под колонтитулом
  bottom: 62, // 22 мм, под номером страницы
  side: 48, // 17 мм
};

export const TYPE = {
  body: 10.5,
  bodyKo: 10,
  leading: 1.6,
  small: 7.5,
};
