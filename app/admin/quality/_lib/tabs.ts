// #352 (§3): вкладки /admin/quality. Банк — Q1 (#352); остальные — свои чаты в app/admin/quality/<вкладка>/*
// (Проверки — Q2 #353, Находки — Q3, Изменения и История — Q4). Пока страницы вкладки нет — app/admin/quality/[tab]
// показывает «скоро»; статическая страница вкладки сама его перекрывает.
export const QUALITY_TABS = [
  { slug: "", label: "Банк" },
  { slug: "checks", label: "Проверки" },
  { slug: "findings", label: "Находки" },
  { slug: "changes", label: "Изменения" },
  { slug: "history", label: "История" },
] as const;

export const SOON_TABS: Record<string, { label: string; what: string; issue: string }> = {
  checks: { label: "Проверки", what: "ссылки проверяющим с выбором материала из банка, режим «слова»", issue: "Q2 #353" },
  findings: { label: "Находки", what: "разбор отзывов по компонентам: промпт, глоссарий, правило проверки, словарь имён, модель", issue: "Q3" },
  changes: { label: "Изменения", what: "предложения правок с eval «было / стало», «Одобрить» и «Отклонить»", issue: "Q4" },
  history: { label: "История", what: "что меняли, по каким отзывам и как изменились метрики", issue: "Q4" },
};

export const tabHref = (slug: string) => (slug ? `/admin/quality/${slug}` : "/admin/quality");
