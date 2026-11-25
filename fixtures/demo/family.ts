// Демо-семья для питча 27.11 (I12). Без server-only: данные читают seed (scripts/seed-demo.ts),
// режим сцены (lib/stage.ts), админка /admin и тесты.
//
// Рассказчики ВЫМЫШЛЕННЫЕ (Ким Чер Су — персонаж eval/personas/kim.md, Ли Нина — пример киоска АКНЦ).
// В интерфейсе это видно по имени семьи «…· пример». Голос в демо — только запись человека, который
// согласился озвучить персонажа (загрузка в /admin с галочкой согласия) → bucket audio, папка `_demo/`.
//
// Тексты глав Ким — те же, что в демо-книге lib/book/pdf/demo.ts (их корейский уже вычитан V2 / kr-check),
// здесь к ним добавлены «сырые» расшифровки, уточнения интервью-агента (банк V0) и факты.
// ID и токены фиксированные: ссылки и QR демо не меняются после сброса.
import type { AiOutput } from "@/lib/ai/types";
import { DEMO_STORIES } from "@/lib/book/pdf/demo";
import type { FollowUp, LifeBlock, StoryFact } from "@/lib/types";

const id = (n: number) => `0de30000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Папка «золотых» файлов демо в хранилищах: не удаляется при сбросе. */
export const DEMO_STORAGE_PREFIX = "_demo";

export const DEMO_FAMILY = {
  id: id(0x1),
  // sha256("kniga-semyi:demo:kim") — 64 hex, как у настоящих семей
  access_token: "988bd31df831624a489e08054fa9e318b0a220ea821983e7d711d685803c827d",
  name: "Семья Ким · пример",
  contact: null,
  gift_date: "2026-12-31",
  source: "family" as const,
  archive_consent: false,
  is_demo: true,
};

export const DEMO_STORYTELLER = {
  id: id(0x11),
  family_id: DEMO_FAMILY.id,
  name: "Ким Чер Су",
  name_ko: "김철수",
  birth_year: 1940,
  death_year: null,
  birth_place: "Уштобе",
  photo_url: null,
  /** Вымышленный персонаж; согласие — у человека, который его озвучил (см. /admin). */
  consent_at: "2026-11-20T10:00:00+05:00",
};

export const DEMO_SESSION_ID = id(0x21);
export const DEMO_BOOK_TITLE = "Книга семьи Ким · пример";

export interface DemoStorySeed {
  id: string;
  /** Ключ файла голоса в audio/_demo/<key>.<ext> */
  key: string;
  question_id: string;
  block: LifeBlock;
  duration_sec: number;
  transcript: string;
  followups: (FollowUp & { duration_sec: number })[];
  facts: StoryFact[];
  edit: AiOutput<"edit">;
  translate: AiOutput<"translate">;
}

type Raw = Omit<DemoStorySeed, "id" | "edit" | "translate"> & { n: number };

const RAW: Raw[] = [
  {
    n: 0x101,
    key: "roots",
    question_id: "roots-05",
    block: "roots",
    duration_sec: 78,
    transcript:
      "Ну, родители мои… они родились на Дальнем Востоке, под Владивостоком. А в тридцать седьмом их посадили в вагон, товарный, и повезли в Казахстан. Больше месяца ехали. Мама говорила, в дороге умер её младший братишка. Отец всегда говорил: корень у нас там, а жить нам здесь.",
    followups: [
      {
        question: "Куда их привезли и как прошла первая зима?",
        answer:
          "В Уштобе привезли, осенью. Голая степь. Первую зиму в землянках жили, сами рыли. Казахи местные молоко приносили, лепёшки. Отец это до конца жизни помнил и нам наказывал помнить.",
        duration_sec: 41,
      },
    ],
    facts: [
      { type: "place", value: "Дальний Восток, под Владивостоком" },
      { type: "event", value: "переселение в Казахстан", year: 1937 },
      { type: "place", value: "Уштобе" },
    ],
  },
  {
    n: 0x102,
    key: "childhood",
    question_id: "childhood-04",
    block: "childhood",
    duration_sec: 64,
    transcript:
      "Я сорокового года, родился в Уштобе. Отец, аппади, в колхозе работал, рис сажали. Зимой мама кукси варила, а мы, четверо, сидим у печки, ждём. Холодно было очень.",
    followups: [
      {
        question: "А летом что вам больше всего запомнилось?",
        answer: "Летом на арык бегали, рыбу руками ловили. Вот это я помню так ясно, как будто вчера было.",
        duration_sec: 22,
      },
    ],
    facts: [
      { type: "date", value: "родился", year: 1940 },
      { type: "place", value: "Уштобе" },
      { type: "person", value: "отец", relation: "отец" },
    ],
  },
  {
    n: 0x103,
    key: "youth",
    question_id: "youth-01",
    block: "youth",
    duration_sec: 71,
    transcript:
      "В школу ходил за пять километров. Тетрадь у нас с братом одна была на двоих — он с одной стороны пишет, я с другой. Чернила из сажи делали.",
    followups: [
      {
        question: "Как вы учили русский язык? Кто вам помог?",
        answer:
          "А по-русски я сначала совсем не говорил. Учительница, Анна Петровна, оставалась со мной после уроков. Через год я лучше всех в классе читал. Мама говорила: учись, сынок, голову у тебя никто не отнимет.",
        duration_sec: 38,
      },
    ],
    facts: [
      { type: "person", value: "Анна Петровна", relation: "учительница" },
      { type: "person", value: "брат", relation: "брат" },
    ],
  },
  {
    n: 0x104,
    key: "work",
    question_id: "work-01",
    block: "work",
    duration_sec: 69,
    transcript:
      "После техникума агрономом стал. Сорок лет на рисовых полях под Уштобе. Весной в четыре утра вставали, воду пускали, каждый чек смотрели. Рис любит воду и терпение. Человек тоже.",
    followups: [
      {
        question: "Чем в этой работе вы гордитесь больше всего?",
        answer: "В семьдесят втором рекордный урожай был, орден дали. Но я больше горжусь, что ни один год бригада без хлеба не осталась.",
        duration_sec: 27,
      },
    ],
    facts: [
      { type: "event", value: "рекордный урожай риса, орден", year: 1972 },
      { type: "place", value: "рисовые поля под Уштобе" },
    ],
  },
  {
    n: 0x105,
    key: "love",
    question_id: "love-01",
    block: "love",
    duration_sec: 52,
    transcript:
      "С бабушкой вашей, с Валентиной, познакомились в шестьдесят третьем, на танцах в клубе. Увидел её — и сразу понял: это моя жена. Она смеялась громче всех.",
    followups: [
      {
        question: "Какой была ваша свадьба?",
        answer: "Свадьбу в сентябре сыграли, после уборки риса. Двести человек гостей, столы прямо во дворе стояли.",
        duration_sec: 24,
      },
      { question: "А что готовили к столу?", answer: "Женщины три дня готовили — чальтоги, кимчи.", duration_sec: 12 },
    ],
    facts: [
      { type: "person", value: "Валентина", relation: "жена" },
      { type: "event", value: "знакомство на танцах", year: 1963 },
    ],
  },
  {
    n: 0x106,
    key: "traditions",
    question_id: "traditions-03",
    block: "traditions",
    duration_sec: 49,
    transcript: "Каждую весну, в хансик, всей семьёй едем на кладбище, к отцу с матерью. Могилы убираем.",
    followups: [
      {
        question: "Что вы ставите на стол в этот день?",
        answer:
          "Что они любили: рис, кукси, рыбу жареную. Ставим — и он как будто с нами. Внуки сначала стеснялись, а теперь сами спрашивают, когда поедем.",
        duration_sec: 33,
      },
    ],
    facts: [{ type: "event", value: "хансик — поминовение весной" }],
  },
  {
    n: 0x107,
    key: "legacy",
    question_id: "legacy-05",
    block: "legacy",
    duration_sec: 58,
    transcript:
      "Внуки мои… Я долгую жизнь прожил и одно понял: богатство не в доме, не в машине. Богатство — когда за столом много своих. Держитесь вместе. Звоните друг другу не по делу, а просто так.",
    followups: [
      {
        question: "Что вам хочется, чтобы внуки помнили о корнях?",
        answer: "Помните, откуда мы пришли. И языка своего не стыдитесь — даже если знаете только «аммони» и «кукси».",
        duration_sec: 19,
      },
    ],
    facts: [],
  },
];

function chapterOf(i: number) {
  const s = DEMO_STORIES[i];
  if (!s) throw new Error(`нет демо-главы ${i}`);
  return s;
}

export const DEMO_STORY_SEEDS: DemoStorySeed[] = RAW.map(({ n, ...r }, i) => {
  const ch = chapterOf(i);
  if (ch.block !== r.block) throw new Error(`демо-глава ${i}: блок ${ch.block} ≠ ${r.block}`);
  return {
    ...r,
    id: id(n),
    edit: { text_ru: ch.text_ru!, title: ch.title!, quote: ch.quote ?? "", facts: r.facts },
    translate: { text_ko: ch.text_ko!, title_ko: ch.title_ko ?? "", quote_ko: ch.quote_ko ?? "" },
  };
});

/** ID записи-уточнения (parent_story_id → основная история): 0x2NM, N — история, M — номер уточнения. */
export const followupStoryId = (storyIndex: number, followupIndex: number) => id(0x200 + (storyIndex + 1) * 0x10 + followupIndex);

/**
 * Запасной результат для блока, которого нет среди глав демо (если на сцене запишут новый ответ «Трудные
 * времена»): тёплая история о помощи соседей. В базу не пишется — только режим сцены.
 * ⚠ Корейский написан для I12 — проверить носителем (kr-check его не видит).
 */
export const DEMO_STAGE_RESERVE: Pick<DemoStorySeed, "question_id" | "block" | "transcript" | "edit" | "translate"> = {
  question_id: "hardship-01",
  block: "hardship",
  transcript:
    "В пятидесятом году у нас дом сгорел. Вся улица пришла помогать — кто саман месил, кто брёвна вёз. Через месяц уже в новом доме жили. Мама потом каждому соседу по тарелке чальтоги отнесла. Добро, говорила, надо возвращать сразу, пока горячее.",
  edit: {
    title: "Дом, который построила улица",
    quote: "Добро надо возвращать сразу, пока горячее.",
    text_ru:
      "В пятидесятом году у нас сгорел дом. Вся улица пришла помогать: кто саман месил, кто брёвна вёз. Через месяц мы уже жили в новом доме.\nМама потом каждому соседу отнесла по тарелке чальтоги. «Добро надо возвращать сразу, пока горячее», — говорила она.",
    facts: [{ type: "event", value: "пожар, соседи построили новый дом", year: 1950 }],
  },
  translate: {
    title_ko: "온 동네가 지어 준 집",
    quote_ko: "은혜는 따뜻할 때 바로 갚아야 한다.",
    text_ko:
      "1950년에 우리 집이 불에 탔다. 온 동네 사람들이 도우러 왔다. 누구는 흙벽돌을 이기고, 누구는 통나무를 실어 왔다. 한 달 뒤에 우리는 벌써 새집에서 살았다.\n어머니는 나중에 이웃집마다 찰떡을 한 접시씩 갖다주셨다. \"은혜는 따뜻할 때 바로 갚아야 한다.\" 어머니는 그렇게 말씀하셨다.",
  },
};

// ---------------- киоск АКНЦ (I4) → кабинет центра (I9) ----------------

export const DEMO_KIOSK_FAMILY = {
  id: id(0x1001),
  // sha256("kniga-semyi:demo:kiosk-li")
  access_token: "ca8a3ce3e3cb41ed9bf5a85a868a75dd55443b246aa2e6dd2aaf12ef7bb78f1c",
  name: "Ли Нина · пример (киоск АКНЦ)",
  contact: null,
  gift_date: null,
  source: "kiosk" as const,
  // пример: семья поставила отдельную галочку «в архив АКНЦ» — история видна во вкладке «Архив АКНЦ»
  archive_consent: true,
  is_demo: true,
};

export const DEMO_KIOSK_STORYTELLER = {
  id: id(0x1011),
  family_id: DEMO_KIOSK_FAMILY.id,
  name: "Ли Нина Петровна",
  name_ko: "이 니나",
  birth_year: 1944,
  death_year: null,
  birth_place: "Кзыл-Орда",
  photo_url: null,
  consent_at: "2026-11-21T11:30:00+05:00",
};

export const DEMO_KIOSK_SESSION_ID = id(0x1021);

/** ⚠ Корейский написан для I12 — проверить носителем. */
export const DEMO_KIOSK_STORY: DemoStorySeed = {
  id: id(0x1101),
  key: "kiosk",
  question_id: "traditions-03",
  block: "traditions",
  duration_sec: 96,
  transcript:
    "Когда внучке год исполнился, мы асянди устроили, как положено. Я сама чальтоги делала, невестка стол накрыла. Внучка поползла и первым схватила карандаш. Все смеются: учёной будет. Что первым возьмёт — такая и судьба, так у нас говорили. Сейчас ей двадцать, на врача учится.",
  followups: [{ question: "Что лежало на столе для выбора?", answer: "Рис, нитки, книжка, деньги, карандаш.", duration_sec: 9 }],
  facts: [
    { type: "event", value: "асянди внучки" },
    { type: "person", value: "внучка", relation: "внучка" },
  ],
  edit: {
    title: "Асянди для внучки",
    quote: "Что первым возьмёт — такая и судьба, так у нас говорили.",
    text_ru:
      "Когда внучке исполнился год, мы устроили асянди, как положено. Я сама делала чальтоги, а невестка накрыла стол: рис, нитки, книжка, деньги, карандаш.\nВнучка поползла и первым схватила карандаш. Все засмеялись: будет учёной. Что первым возьмёт — такая и судьба, так у нас говорили.\nСейчас ей двадцать, она учится на врача. Вот и не верь после этого.",
    facts: [],
  },
  translate: {
    title_ko: "손녀의 돌잔치",
    quote_ko: "맨 먼저 잡는 것이 그 아이의 운명이라고 우리는 말하곤 했다.",
    text_ko:
      "손녀가 첫돌을 맞았을 때 우리는 격식대로 돌잔치를 열었다. 나는 손수 찰떡을 만들었고, 며느리는 상을 차렸다. 상 위에는 쌀, 실, 책, 돈, 연필을 올려놓았다.\n손녀는 기어가더니 맨 먼저 연필을 잡았다. 모두 웃으며 학자가 되겠다고 했다. 맨 먼저 잡는 것이 그 아이의 운명이라고 우리는 말하곤 했다.\n지금 손녀는 스무 살이고, 의사가 되려고 공부하고 있다. 그러니 어찌 안 믿을 수 있겠는가.",
  },
};

// ---------------- сказка для внуков (I8) ----------------

export const DEMO_TALE_EXTRA_ID = id(0x401);

export const DEMO_TALE: AiOutput<"tale"> = {
  title: "Мальчик, который умел ждать",
  pages: [
    {
      text: "Давным-давно, когда дедушка был совсем маленьким, его семья приехала в широкую степь у города Уштобе. Добрые соседи принесли им тёплое молоко и круглые лепёшки.",
      illustrationPrompt: "a Korean family arriving in a wide autumn steppe, kind neighbors bringing a jug of milk and round flatbread",
    },
    {
      text: "Зимой мама варила кукси, а четверо детей сидели у печки и грели ладошки. Пахло так вкусно, что ждать было почти невозможно.",
      illustrationPrompt: "four children warming their hands by a clay stove while their mother cooks noodle soup, cozy winter evening",
    },
    {
      text: "У мальчика с братом была одна тетрадь на двоих. Брат писал с одной стороны, а он — с другой, и оба старались писать красиво.",
      illustrationPrompt: "two little brothers sharing one notebook at a wooden table, each writing from his own side",
    },
    {
      text: "Каждую весну вся семья собирается вместе и ставит на стол любимую еду бабушки и дедушки. А ты знаешь, какую еду любит твой дедушка?",
      illustrationPrompt: "a big family around a spring table with rice and noodles, a smiling grandfather with his grandchildren",
    },
  ],
};

/** Главы, из которых «написана» сказка (как выбрал бы pickTaleStories: разные блоки, сказочные первыми). */
export const DEMO_TALE_STORY_KEYS = ["roots", "childhood", "youth", "traditions"] as const;

// ---------------- словарь имён демо-семьи (#125 → страница /f/<токен>/names, #104) ----------------

export interface DemoEntitySeed {
  kind: "person" | "place" | "word";
  name_ru: string;
  /** Как написано в корейском тексте глав (сверяет тест fixtures/demo/family.test.ts) */
  name_ko: string;
  description: string;
  /** Ключи глав (DemoStorySeed.key), где встречается — в тексте главы RU есть это слово */
  stories: string[];
}

/**
 * Словарь «Семьи Ким»: seed-demo пишет его как сборка глав (#102, source=auto), потому что демо-главы
 * вставляются готовыми, без конвейера. KR — ровно как в корейском тексте глав и по docs/glossary.md.
 */
export const DEMO_ENTITIES: DemoEntitySeed[] = [
  { kind: "place", name_ru: "Уштобе", name_ko: "우슈토베", description: "куда в 1937 году привезли родителей; здесь родился рассказчик", stories: ["roots", "childhood", "work"] },
  { kind: "place", name_ru: "Дальний Восток", name_ko: "극동", description: "родина родителей, под Владивостоком", stories: ["roots"] },
  { kind: "place", name_ru: "Владивосток", name_ko: "블라디보스토크", description: "рядом с ним родились родители", stories: ["roots"] },
  { kind: "person", name_ru: "Анна Петровна", name_ko: "안나 페트로브나", description: "учительница, учила русскому после уроков", stories: ["youth"] },
  { kind: "person", name_ru: "Валентина", name_ko: "발렌티나", description: "жена, бабушка внуков", stories: ["love"] },
  { kind: "word", name_ru: "кукси", name_ko: "국수", description: "лапша — зимняя еда детства и блюдо на хансик", stories: ["childhood", "traditions", "legacy"] },
  { kind: "word", name_ru: "аппади", name_ko: "아버지", description: "отец (корё мар)", stories: ["childhood"] },
  { kind: "word", name_ru: "омани", name_ko: "어머니", description: "мама (корё мар)", stories: ["childhood"] },
  { kind: "word", name_ru: "хансик", name_ko: "한식", description: "весенний день поминовения, едут к родителям", stories: ["traditions"] },
  { kind: "word", name_ru: "чальтоги", name_ko: "찰떡", description: "клейкие рисовые лепёшки к свадебному столу", stories: ["love"] },
];

// ---------------- все ID демо: сброс удаляет только их ----------------

export const DEMO_FAMILY_IDS = [DEMO_FAMILY.id, DEMO_KIOSK_FAMILY.id] as const;
