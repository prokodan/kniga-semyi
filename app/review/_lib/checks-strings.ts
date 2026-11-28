// #353: подписи /review 2.0 — на языке интерфейса проверяющего (ko / kk / ru) и, если он не ru, ещё по-русски.
// ⚠️ ВЫЧИТАТЬ НОСИТЕЛЮ (#258): корейские и казахские строки ниже (KO, KK, якоря критериев, примеры) написаны
// без носителя. Носитель может поправить их прямо в ссылке — комментарием к любому тексту.
import type { BookLang, ReviewAxis } from "@/lib/types";
import type { UiLang } from "@/app/admin/quality/checks/_lib/core";

export type L = { native: string; ru: string };

const RU = {
  title: "Проверка перевода",
  hello: "Здравствуйте! Спасибо, что помогаете.",
  needTitle: "Что от вас нужно",
  needText1: "Прочитайте оригинал и перевод — абзац за абзацем.",
  needText2: "Если звучит не так, нажмите на абзац перевода и исправьте прямо в тексте.",
  needText3: "Поставьте 5 оценок от 1 до 5 и, если хочется, напишите пару слов.",
  needTerms1: "В переводе выделены 3–8 слов: родство, обращения, реалии, даты.",
  needTerms2: "Про каждое слово ответьте: «верно» или «неверно» — и как правильно.",
  needTerms3: "Остальной текст можно не читать.",
  time: "Займёт ≈ {a}–{b} минут · текстов: {n}",
  pause: "Можно прерваться: всё сохраняется само — вернитесь по этой же ссылке.",
  fiction: "Все истории — о вымышленных людях.",
  exampleTitle: "Пример хорошей проверки",
  exampleWhy: "Почему так",
  start: "Начать",
  resume: "Продолжить · {n} из {total}",
  source: "Оригинал (русский)",
  target: "Перевод",
  tapToEdit: "Нажмите, чтобы исправить",
  save: "Сохранить",
  cancel: "Отмена",
  restore: "Вернуть как было",
  edited: "Исправлено",
  yourEdit: "Ваша правка",
  commentPara: "Комментарий к абзацу (необязательно)",
  comment: "Комментарий ко всему тексту (необязательно)",
  criteriaTitle: "Оцените перевод",
  criteriaHint: "Нажмите цифру от 1 до 5. Подсказки — под 1, 3 и 5.",
  termsTitle: "Проверьте выделенные слова",
  termsHint: "Остальной текст можно не читать.",
  right: "Верно",
  wrong: "Неверно",
  howRight: "Как правильно?",
  showSource: "Показать оригинал",
  skip: "Не знаю — пропустить",
  skipped: "Пропущено. Можно вернуться к тексту в любой момент.",
  unskip: "Вернуться к тексту",
  prev: "Назад",
  next: "Дальше",
  finish: "Готово",
  progress: "{n} из {total}",
  itemOf: "Текст {i} из {total}",
  saved: "Сохранено",
  saving: "Сохраняю…",
  saveError: "Не сохранилось — нажмите ещё раз",
  doneTitle: "Спасибо!",
  doneText: "Всё сохранено. Ваши правки помогут, чтобы перевод звучал живо.",
  sumChecked: "Проверено текстов: {n} из {total}",
  sumEdits: "Исправлено абзацев: {n}",
  sumWrong: "Отмечено неверных слов: {n}",
  sumSkipped: "Пропущено: {n}",
  back: "Вернуться к текстам",
  invalid: "Ссылка неверная. Уточните её у того, кто прислал.",
  expired: "Ссылка истекла или отозвана. Попросите новую у того, кто её прислал.",
  empty: "В этой ссылке пока нет текстов.",
} as const;

type Key = keyof typeof RU;

// вычитать носителю (#258)
const KO: Record<Key, string> = {
  title: "번역 검토",
  hello: "안녕하세요! 도와주셔서 감사합니다.",
  needTitle: "부탁드리는 일",
  needText1: "원문과 번역을 문단별로 읽어 주세요.",
  needText2: "어색한 곳이 있으면 번역 문단을 눌러 바로 고쳐 주세요.",
  needText3: "1~5점으로 다섯 가지를 평가하고, 원하시면 한두 마디 남겨 주세요.",
  needTerms1: "번역에서 3~8개 단어가 표시되어 있습니다: 가족 호칭, 부르는 말, 생활 용어, 날짜.",
  needTerms2: "단어마다 ‘맞음’ 또는 ‘틀림’을 고르고, 틀리면 바른 말을 적어 주세요.",
  needTerms3: "나머지 글은 읽지 않으셔도 됩니다.",
  time: "약 {a}~{b}분 · 글 {n}개",
  pause: "중간에 멈춰도 됩니다. 모두 자동으로 저장되니 같은 링크로 다시 오세요.",
  fiction: "모든 이야기는 지어낸 인물의 이야기입니다.",
  exampleTitle: "좋은 검토의 예",
  exampleWhy: "이유",
  start: "시작하기",
  resume: "계속하기 · {total}개 중 {n}개",
  source: "원문 (러시아어)",
  target: "번역",
  tapToEdit: "고치려면 누르세요",
  save: "저장",
  cancel: "취소",
  restore: "원래대로",
  edited: "수정됨",
  yourEdit: "고친 내용",
  commentPara: "이 문단에 대한 의견 (선택)",
  comment: "글 전체에 대한 의견 (선택)",
  criteriaTitle: "번역 평가",
  criteriaHint: "1~5 중 하나를 누르세요. 1, 3, 5 아래에 설명이 있습니다.",
  termsTitle: "표시된 단어를 확인해 주세요",
  termsHint: "나머지 글은 읽지 않으셔도 됩니다.",
  right: "맞음",
  wrong: "틀림",
  howRight: "바른 말은?",
  showSource: "원문 보기",
  skip: "잘 모르겠어요 — 건너뛰기",
  skipped: "건너뛰었습니다. 언제든 다시 볼 수 있습니다.",
  unskip: "다시 보기",
  prev: "이전",
  next: "다음",
  finish: "완료",
  progress: "{total}개 중 {n}개",
  itemOf: "{total}개 중 {i}번째 글",
  saved: "저장됨",
  saving: "저장 중…",
  saveError: "저장하지 못했습니다 — 다시 눌러 주세요",
  doneTitle: "감사합니다!",
  doneText: "모두 저장되었습니다. 고쳐 주신 내용 덕분에 번역이 더 자연스러워집니다.",
  sumChecked: "검토한 글: {total}개 중 {n}개",
  sumEdits: "고친 문단: {n}개",
  sumWrong: "틀림으로 표시한 단어: {n}개",
  sumSkipped: "건너뛴 글: {n}개",
  back: "글로 돌아가기",
  invalid: "링크가 잘못되었습니다. 보내 준 분께 다시 확인해 주세요.",
  expired: "링크가 만료되었거나 취소되었습니다. 보내 준 분께 새 링크를 요청해 주세요.",
  empty: "이 링크에는 아직 글이 없습니다.",
};

// вычитать носителю (#258)
const KK: Record<Key, string> = {
  title: "Аударманы тексеру",
  hello: "Сәлеметсіз бе! Көмектескеніңізге рахмет.",
  needTitle: "Сізден не керек",
  needText1: "Түпнұсқа мен аударманы абзац-абзацымен оқыңыз.",
  needText2: "Бір жері дұрыс естілмесе, аударма абзацын басып, сол жерде түзетіңіз.",
  needText3: "1-ден 5-ке дейін 5 баға қойыңыз, қаласаңыз, бір-екі сөз жазыңыз.",
  needTerms1: "Аудармада 3–8 сөз белгіленген: туыстық, қаратпа сөздер, тұрмыс атаулары, күндер.",
  needTerms2: "Әр сөзге «дұрыс» не «қате» деп жауап беріңіз, қате болса — қалай дұрыс.",
  needTerms3: "Қалған мәтінді оқымасаңыз да болады.",
  time: "Шамамен {a}–{b} минут · мәтін саны: {n}",
  pause: "Тоқтап қалуға болады: бәрі өзі сақталады — осы сілтеме арқылы қайта оралыңыз.",
  fiction: "Барлық әңгіме — ойдан шығарылған кейіпкерлер туралы.",
  exampleTitle: "Жақсы тексерудің үлгісі",
  exampleWhy: "Неге",
  start: "Бастау",
  resume: "Жалғастыру · {total} мәтіннің {n}",
  source: "Түпнұсқа (орысша)",
  target: "Аударма",
  tapToEdit: "Түзету үшін басыңыз",
  save: "Сақтау",
  cancel: "Болдырмау",
  restore: "Бастапқы қалпына",
  edited: "Түзетілді",
  yourEdit: "Сіздің түзетуіңіз",
  commentPara: "Абзац туралы пікір (міндетті емес)",
  comment: "Бүкіл мәтін туралы пікір (міндетті емес)",
  criteriaTitle: "Аударманы бағалаңыз",
  criteriaHint: "1-ден 5-ке дейінгі санды басыңыз. Түсініктеме — 1, 3 және 5 астында.",
  termsTitle: "Белгіленген сөздерді тексеріңіз",
  termsHint: "Қалған мәтінді оқымасаңыз да болады.",
  right: "Дұрыс",
  wrong: "Қате",
  howRight: "Қалай дұрыс?",
  showSource: "Түпнұсқаны көрсету",
  skip: "Білмеймін — өткізіп жіберу",
  skipped: "Өткізілді. Мәтінге кез келген уақытта оралуға болады.",
  unskip: "Мәтінге оралу",
  prev: "Артқа",
  next: "Келесі",
  finish: "Дайын",
  progress: "{total} мәтіннің {n}",
  itemOf: "{total} мәтіннің {i}-сі",
  saved: "Сақталды",
  saving: "Сақталуда…",
  saveError: "Сақталмады — қайта басыңыз",
  doneTitle: "Рахмет!",
  doneText: "Бәрі сақталды. Сіздің түзетулеріңіз аударманы табиғи етуге көмектеседі.",
  sumChecked: "Тексерілген мәтін: {total} мәтіннің {n}",
  sumEdits: "Түзетілген абзац: {n}",
  sumWrong: "Қате деп белгіленген сөз: {n}",
  sumSkipped: "Өткізілген: {n}",
  back: "Мәтіндерге оралу",
  invalid: "Сілтеме қате. Жіберген адамнан қайта сұраңыз.",
  expired: "Сілтеменің мерзімі өтті немесе ол жабылды. Жіберген адамнан жаңа сілтеме сұраңыз.",
  empty: "Бұл сілтемеде әзірге мәтін жоқ.",
};

type Anchor = { label: string; a1: string; a3: string; a5: string };
// Критерии §4: якоря 1 — смысл искажён, 3 — понятно, но неестественно, 5 — как сказал бы носитель (по каждой оси — своими словами).
const CRIT: Record<"ru" | "ko" | "kk", Record<ReviewAxis, Anchor>> = {
  ru: {
    meaning: { label: "Смысл", a1: "искажён, потерян факт", a3: "понятно, но неточно", a5: "точно как в оригинале" },
    natural: { label: "Естественность", a1: "так не говорят", a3: "понятно, но неестественно", a5: "как сказал бы носитель" },
    respect: { label: "Обращение и регистр", a1: "не тот тон к старшим / внукам", a3: "местами не тот тон", a5: "как в живой семье" },
    names: { label: "Имена и реалии", a1: "искажены", a3: "понятно, но пишется иначе", a5: "всё названо верно" },
    grammar: { label: "Грамматика", a1: "много ошибок", a3: "есть ошибки, смысл ясен", a5: "без ошибок" },
  },
  // вычитать носителю (#258)
  ko: {
    meaning: { label: "의미", a1: "뜻이 틀림, 사실이 빠짐", a3: "이해는 되지만 부정확", a5: "원문과 똑같이 정확" },
    natural: { label: "자연스러움", a1: "이렇게 말하지 않음", a3: "이해는 되지만 어색함", a5: "한국 사람이 말하듯" },
    respect: { label: "호칭과 말투", a1: "어른·손주에게 맞지 않는 말투", a3: "군데군데 말투가 어색", a5: "실제 가족처럼" },
    names: { label: "이름과 용어", a1: "틀리게 씀", a3: "이해는 되지만 표기가 다름", a5: "모두 바르게 씀" },
    grammar: { label: "문법", a1: "틀린 곳이 많음", a3: "틀린 곳이 있지만 뜻은 통함", a5: "틀린 곳 없음" },
  },
  // вычитать носителю (#258)
  kk: {
    meaning: { label: "Мағынасы", a1: "бұрмаланған, дерек жоғалған", a3: "түсінікті, бірақ дәл емес", a5: "түпнұсқадағыдай дәл" },
    natural: { label: "Табиғилығы", a1: "былай айтпайды", a3: "түсінікті, бірақ жасанды", a5: "қазақ айтқандай" },
    respect: { label: "Қаратпа мен сөйлеу мәнері", a1: "үлкенге / немереге лайық емес", a3: "кей жерде мәнері басқа", a5: "нағыз отбасындағыдай" },
    names: { label: "Есімдер мен атаулар", a1: "бұрмаланған", a3: "түсінікті, бірақ басқаша жазылады", a5: "бәрі дұрыс аталған" },
    grammar: { label: "Грамматикасы", a1: "қате көп", a3: "қате бар, мағынасы түсінікті", a5: "қатесіз" },
  },
};

/** Пример хорошей проверки — по языку перевода (вымышленный). */
export interface CheckExample {
  source: string;
  model: string;
  fixed: string;
  ratings: Partial<Record<ReviewAxis, number>>;
  why: L;
  term: { term: string; ok: boolean; fix: string };
}

// вычитать носителю (#258)
const EXAMPLES: Record<"ko" | "kk", { source: string; model: string; fixed: string; ratings: Partial<Record<ReviewAxis, number>>; why: Record<"ru" | "ko" | "kk", string>; term: { term: string; ok: boolean; fix: string } }> = {
  ko: {
    source: "Мой старший брат ушёл на фронт в сорок втором.",
    model: "내 남동생은 42년에 전선으로 떠났다.",
    fixed: "우리 형은 42년에 전선으로 떠났다.",
    ratings: { meaning: 2, natural: 3, respect: 4, names: 5, grammar: 5 },
    why: {
      ru: "Рассказчик — мужчина: «старший брат» — 형, а не 남동생 (это младший брат).",
      ko: "화자가 남자이므로 ‘старший брат’는 남동생(아래 동생)이 아니라 형입니다.",
      kk: "Әңгімелеуші — ер адам: «старший брат» корейше 형, ал 남동생 — інісі.",
    },
    term: { term: "남동생", ok: false, fix: "형" },
  },
  kk: {
    source: "Апа всегда пекла нам баурсаки к празднику.",
    model: "Апа бізге мерекеге әрқашан бауырсақ пісіретін.",
    fixed: "Әжеміз бізге мерекеге әрқашан бауырсақ пісіретін.",
    ratings: { meaning: 3, natural: 4, respect: 3, names: 3, grammar: 5 },
    why: {
      ru: "В этой семье «апа» — бабушка, по-казахски здесь естественнее «әжеміз».",
      ko: "이 가족에서 ‘апа’는 할머니라서 카자흐어로는 ‘әжеміз’가 더 자연스럽습니다.",
      kk: "Бұл отбасында «апа» — әже, сондықтан мұнда «әжеміз» деген табиғи.",
    },
    term: { term: "Апа", ok: false, fix: "Әжеміз" },
  },
};

function native(lang: UiLang): Record<Key, string> {
  return lang === "kk" ? KK : lang === "ko" ? KO : RU;
}

export function ct(lang: UiLang, key: Key, vars: Record<string, string | number> = {}): L {
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
  return { native: fill(native(lang)[key]), ru: lang === "ru" ? "" : fill(RU[key]) };
}

export type CriterionText = { label: L; a1: L; a3: L; a5: L };

export function checkDictionary(lang: UiLang, target: BookLang) {
  const keys = Object.keys(RU) as Key[];
  const strings = Object.fromEntries(keys.map((k) => [k, ct(lang, k)])) as Record<Key, L>;
  const crit = Object.fromEntries(
    (Object.keys(CRIT.ru) as ReviewAxis[]).map((axis) => {
      const n = CRIT[lang][axis];
      const r = CRIT.ru[axis];
      const pick = (f: keyof Anchor): L => ({ native: n[f], ru: lang === "ru" ? "" : r[f] });
      return [axis, { label: pick("label"), a1: pick("a1"), a3: pick("a3"), a5: pick("a5") }];
    }),
  ) as Record<ReviewAxis, CriterionText>;
  const ex = EXAMPLES[target === "kk" ? "kk" : "ko"];
  const example: CheckExample = {
    source: ex.source,
    model: ex.model,
    fixed: ex.fixed,
    ratings: ex.ratings,
    why: { native: ex.why[lang], ru: lang === "ru" ? "" : ex.why.ru },
    term: ex.term,
  };
  return { strings, crit, example };
}

export type CheckDictionary = ReturnType<typeof checkDictionary>;

/** Для экрана «ссылка неверная»: на всех трёх языках. */
export function closedText(key: "invalid" | "expired", lang: UiLang | null): L[] {
  const langs: UiLang[] = lang ? [lang] : ["ko", "kk"];
  return [...langs.map((l) => ({ native: native(l)[key], ru: "" })), ...(langs.includes("ru") ? [] : [{ native: RU[key], ru: "" }])];
}
