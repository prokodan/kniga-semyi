// #232: подписи страницы носителя — на языке пары (ko / kk) и по-русски. Носитель может поправить и их:
// комментарий к любому тексту попадёт в eval/reviews.
import type { BookLang, ReviewAxis } from "@/lib/types";

export type L = { native: string; ru: string };

type Key =
  | "title"
  | "intro"
  | "introQuestions"
  | "fiction"
  | "source"
  | "target"
  | "tapToEdit"
  | "edit"
  | "save"
  | "cancel"
  | "restore"
  | "edited"
  | "comment"
  | "commentPara"
  | "rateWhole"
  | "scale"
  | "skip"
  | "skipped"
  | "unskip"
  | "prev"
  | "next"
  | "done"
  | "doneText"
  | "saved"
  | "saving"
  | "saveError"
  | "progress"
  | "invalid"
  | "expired"
  | "empty";

const KO: Record<Key, string> = {
  title: "번역 검토",
  intro: "도와주셔서 감사합니다! 원문과 번역이 문단별로 나란히 있습니다. 번역 문단을 누르면 바로 고칠 수 있습니다. 모든 내용은 자동으로 저장되니, 창을 닫았다가 같은 링크로 다시 오셔도 됩니다.",
  introQuestions: "할머니, 할아버지께 드리는 질문입니다. 자연스럽고 공손하게 들리도록 고쳐 주세요. 모든 내용은 자동으로 저장됩니다.",
  fiction: "모든 이야기는 지어낸 인물의 이야기입니다.",
  source: "원문 (러시아어)",
  target: "번역 (한국어)",
  tapToEdit: "고치려면 누르세요",
  edit: "고치기",
  save: "저장",
  cancel: "취소",
  restore: "원래대로",
  edited: "수정됨",
  comment: "이 글에 대한 의견 (선택)",
  commentPara: "이 문단에 대한 의견 (선택)",
  rateWhole: "글 전체 평가",
  scale: "1 — 나쁨, 5 — 아주 좋음",
  skip: "잘 모르겠어요, 건너뛰기",
  skipped: "건너뜀",
  unskip: "다시 보기",
  prev: "이전",
  next: "다음",
  done: "완료",
  doneText: "감사합니다! 모든 내용이 저장되었습니다.",
  saved: "저장됨",
  saving: "저장 중…",
  saveError: "저장하지 못했습니다. 다시 눌러 주세요.",
  progress: "{total}개 중 {n}개 확인",
  invalid: "링크가 잘못되었습니다. 보내 준 분께 다시 확인해 주세요.",
  expired: "링크가 만료되었거나 취소되었습니다. 보내 준 분께 새 링크를 요청해 주세요.",
  empty: "이 링크에는 아직 글이 없습니다.",
};

const KK: Record<Key, string> = {
  title: "Аударманы тексеру",
  intro: "Көмектескеніңізге рахмет! Түпнұсқа мен аударма абзац-абзацымен қатар тұр. Түзету үшін аударма абзацын басыңыз. Бәрі өзі сақталады — бетті жауып, осы сілтеме арқылы қайта оралуға болады.",
  introQuestions: "Бұл — әжелер мен аталарға қоятын сұрақтарымыз. Табиғи әрі сыпайы естілуі үшін түзетіңіз. Бәрі өзі сақталады.",
  fiction: "Барлық әңгіме — ойдан шығарылған кейіпкерлер туралы.",
  source: "Түпнұсқа (орысша)",
  target: "Аударма (қазақша)",
  tapToEdit: "Түзету үшін басыңыз",
  edit: "Түзету",
  save: "Сақтау",
  cancel: "Болдырмау",
  restore: "Бастапқы қалпына",
  edited: "Түзетілді",
  comment: "Мәтін туралы пікір (міндетті емес)",
  commentPara: "Абзац туралы пікір (міндетті емес)",
  rateWhole: "Бүкіл мәтінге баға",
  scale: "1 — нашар, 5 — өте жақсы",
  skip: "Білмеймін, өткізіп жіберу",
  skipped: "Өткізілді",
  unskip: "Қайта қарау",
  prev: "Артқа",
  next: "Келесі",
  done: "Дайын",
  doneText: "Рахмет! Бәрі сақталды.",
  saved: "Сақталды",
  saving: "Сақталуда…",
  saveError: "Сақталмады. Қайта басыңыз.",
  progress: "{total} мәтіннің {n} тексерілді",
  invalid: "Сілтеме қате. Жіберген адамнан қайта сұраңыз.",
  expired: "Сілтеменің мерзімі өтті немесе ол жабылды. Жіберген адамнан жаңа сілтеме сұраңыз.",
  empty: "Бұл сілтемеде әзірге мәтін жоқ.",
};

const RU: Record<Key, string> = {
  title: "Проверка перевода",
  intro: "Спасибо, что помогаете! Оригинал и перевод стоят рядом, абзац к абзацу. Нажмите на абзац перевода, чтобы исправить. Всё сохраняется само — можно закрыть страницу и вернуться по этой же ссылке.",
  introQuestions: "Это вопросы, которые мы задаём бабушкам и дедушкам. Поправьте, чтобы звучало естественно и уважительно. Всё сохраняется само.",
  fiction: "Все истории — о вымышленных людях.",
  source: "Оригинал (русский)",
  target: "Перевод",
  tapToEdit: "Нажмите, чтобы исправить",
  edit: "Исправить",
  save: "Сохранить",
  cancel: "Отмена",
  restore: "Вернуть как было",
  edited: "Исправлено",
  comment: "Комментарий к тексту (необязательно)",
  commentPara: "Комментарий к абзацу (необязательно)",
  rateWhole: "Оценка всего текста",
  scale: "1 — плохо, 5 — отлично",
  skip: "Не знаю, пропустить",
  skipped: "Пропущено",
  unskip: "Вернуться к тексту",
  prev: "Назад",
  next: "Дальше",
  done: "Готово",
  doneText: "Спасибо! Всё сохранено.",
  saved: "Сохранено",
  saving: "Сохраняю…",
  saveError: "Не сохранилось. Нажмите ещё раз.",
  progress: "Проверено {n} из {total}",
  invalid: "Ссылка неверная. Уточните её у того, кто прислал.",
  expired: "Ссылка истекла или отозвана. Попросите новую у того, кто её прислал.",
  empty: "В этой ссылке пока нет текстов.",
};

const AXES: Record<ReviewAxis, { ko: string; kk: string; ru: string }> = {
  meaning: { ko: "의미", kk: "Мағынасы", ru: "Смысл" },
  grammar: { ko: "문법", kk: "Грамматикасы", ru: "Грамматика" },
  natural: { ko: "자연스러움", kk: "Табиғилығы", ru: "Естественно ли звучит" },
  respect: { ko: "어른께 쓰는 말", kk: "Үлкенге құрмет", ru: "Обращение к старшим" },
  names: { ko: "이름과 지명·용어", kk: "Есімдер мен атаулар", ru: "Имена и реалии" },
};

function native(lang: BookLang): Record<Key, string> {
  return lang === "kk" ? KK : KO;
}

/** Подпись на языке носителя + по-русски. Для русского носителя — только русский. */
export function t(lang: BookLang, key: Key, vars: Record<string, string | number> = {}): L {
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
  if (lang === "ru") return { native: fill(RU[key]), ru: "" };
  return { native: fill(native(lang)[key]), ru: fill(RU[key]) };
}

export function axisLabel(lang: BookLang, axis: ReviewAxis): L {
  const a = AXES[axis];
  if (lang === "ru") return { native: a.ru, ru: "" };
  return { native: lang === "kk" ? a.kk : a.ko, ru: a.ru };
}

/** Строки для клиента: все ключи сразу (клиентский компонент не импортирует словари целиком по языкам). */
export function dictionary(lang: BookLang): Record<Key, L> & { axes: Record<ReviewAxis, L> } {
  const keys = Object.keys(RU) as Key[];
  const out = Object.fromEntries(keys.map((k) => [k, t(lang, k)])) as Record<Key, L>;
  const axes = Object.fromEntries((Object.keys(AXES) as ReviewAxis[]).map((a) => [a, axisLabel(lang, a)])) as Record<ReviewAxis, L>;
  return { ...out, axes };
}

export type ReviewDictionary = ReturnType<typeof dictionary>;
