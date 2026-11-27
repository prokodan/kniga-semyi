// Контракты домена. Владелец — Z6. Меняется только вместе с миграцией в supabase/migrations.
// Поля в snake_case, как в базе, чтобы строки Supabase типизировались без маппинга.

export type Uuid = string;
export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string;

/** 8 блоков карты жизни. Тексты блоков и вопросы — content/questions (V0). */
export const LIFE_BLOCKS = [
  "roots", // Корни: родители, деды, откуда семья
  "childhood", // Детство: дом, игры, еда, первые воспоминания
  "youth", // Школа и юность
  "work", // Работа и дело жизни
  "love", // Любовь и своя семья
  "hardship", // Трудные времена и как их пережили
  "traditions", // Традиции, праздники, кухня, язык (корё мар)
  "legacy", // Наказ потомкам — «Слова деда»
] as const;
export type LifeBlock = (typeof LIFE_BLOCKS)[number];

/** skipped — ответ-отказ («не хочу отвечать»): запись сохранена, вопрос пропущен, главой не становится. */
export type StoryStatus = "uploaded" | "transcribing" | "editing" | "translating" | "ready" | "failed" | "skipped";
export type BookStatus = "draft" | "building" | "ready" | "failed";
export type SessionMode = "family" | "kiosk";
export type DemoOrderStatus = "created" | "paid_demo" | "cancelled";

// ── Языки (#230, docs/v2/LANGUAGES.md §1) ────────────────
/** Язык текста главы / книги (ISO 639-1). */
export type BookLang = "ru" | "ko" | "kk";
/** Язык рассказа: koryo — корё мар (диалект, вместе с ru — как сейчас), kk — казахский. */
export type SpokenLang = "ru" | "kk" | "koryo";
/** Значения по умолчанию = сегодняшний продукт (как в миграции 20261127180000). */
export const DEFAULT_BOOK_LANGS: readonly BookLang[] = ["ru", "ko"];
export const DEFAULT_SPOKEN_LANGS: readonly SpokenLang[] = ["ru", "koryo"];
export const DEFAULT_CULTURE_PACKS: readonly string[] = ["general", "koryo"];

export type StoryTextOrigin = "ai" | "family" | "proofread";
export type StoryTextStatus = "ready" | "review" | "approved";

/** Текст главы на одном языке (story_texts). Колонки stories (text_ru / *_ko) — зеркало для ru и ko. */
export interface StoryText {
  story_id: Uuid;
  lang: BookLang;
  title: string | null;
  text: string | null;
  quote: string | null;
  origin: StoryTextOrigin;
  status: StoryTextStatus;
  updated_at: IsoDateTime;
}

/** Порядок статусов конвейера истории (failed — терминальный из любого шага). */
export const STORY_PIPELINE: readonly StoryStatus[] = ["uploaded", "transcribing", "editing", "translating", "ready"];

export interface Family {
  id: Uuid;
  name: string;
  access_token: string;
  gift_date: IsoDate | null;
  source: SessionMode;
  contact: string | null;
  archive_consent: boolean;
  is_demo: boolean;
  /** #223: флаги функций, включённые этой семье (имена из lib/flags/registry.ts). В базе `text[] not null default '{}'`;
   *  в типе необязательно — объекты в памяти и фикстуры демо его не задают (= пусто). */
  labs?: string[];
  /** #230: языки книги, первый — основной. В базе `text[] not null default '{ru,ko}'`; нет в объекте — DEFAULT_BOOK_LANGS. */
  book_langs?: BookLang[];
  /** #230: культурные пакеты вопросов (general + слои). В базе default '{general,koryo}'; нет — DEFAULT_CULTURE_PACKS. */
  culture_packs?: string[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Storyteller {
  id: Uuid;
  family_id: Uuid;
  name: string;
  name_ko: string | null;
  birth_year: number | null;
  death_year: number | null;
  birth_place: string | null;
  photo_url: string | null;
  consent_audio_url: string | null;
  consent_at: IsoDateTime | null;
  /** #230: язык рассказа. В базе `text[] not null default '{ru,koryo}'`; нет в объекте — DEFAULT_SPOKEN_LANGS. */
  spoken_langs?: SpokenLang[];
  /** #235: человек древа (family_entities), который этот рассказчик. Нет колонки / не связан — null или нет поля. */
  entity_id?: Uuid | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface InterviewState {
  current_question_id?: string;
  followups_asked?: number;
  covered_blocks?: LifeBlock[];
  skipped_question_ids?: string[];
  later_question_ids?: string[];
}

export interface Session {
  id: Uuid;
  family_id: Uuid;
  storyteller_id: Uuid;
  mode: SessionMode;
  volunteer_id: Uuid | null;
  state: InterviewState;
  started_at: IsoDateTime;
  ended_at: IsoDateTime | null;
}

/** Факт для карты жизни (и будущего древа). */
export interface StoryFact {
  type: "person" | "place" | "date" | "event";
  value: string;
  year?: number;
  relation?: string; // для person: «мать», «брат»…
}

export interface FollowUp {
  question: string;
  answer: string;
  /** #98: запись-уточнение (stories.id с parent_story_id), из которой пришёл ответ, — чтобы не приклеить её дважды */
  story_id?: Uuid;
}

/**
 * #140: ответ засчитан до расшифровки (#107) — полноту проверяет конвейер после расшифровки.
 * pending — ждёт проверки; ask — минимума не хватает, интервью задаст `text` в конце раздела или в следующей сессии.
 * Проверено и хватает / уточнение задано — null.
 */
export interface DeferredFollowup {
  status: "pending" | "ask";
  question_id: string;
  /** Готовый текст уточнения (только для ask) */
  text?: string;
  checked_at?: IsoDateTime;
}

export interface Story {
  id: Uuid;
  family_id: Uuid;
  storyteller_id: Uuid;
  session_id: Uuid | null;
  /** Голосовой ответ на уточнение: ссылка на основную историю. Такая запись только расшифровывается
   *  (transcript уходит в followups основной), главой не становится. null — обычная история. */
  parent_story_id: Uuid | null;
  question_id: string | null;
  block: LifeBlock | null;
  audio_url: string | null;
  duration_sec: number | null;
  transcript: string | null;
  text_ru: string | null;
  text_ko: string | null;
  title: string | null;
  title_ko: string | null;
  quote: string | null;
  quote_ko: string | null;
  facts: StoryFact[];
  followups: FollowUp[];
  status: StoryStatus;
  error: string | null;
  sort_order: number | null;
  /** Сколько раз kick-stuck перезапускал историю (после 3 → failed). Нет в старых строках — 0. */
  kick_attempts?: number;
  /** #140: отложенная проверка полноты (stories.deferred_followup jsonb). Нет в старых строках / до миграции — null. */
  deferred_followup?: DeferredFollowup | null;
  /** Шаг конвейера сейчас выполняется с этого момента (аренда 65 с); null — никто не работает. */
  step_started_at?: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Book {
  id: Uuid;
  family_id: Uuid;
  status: BookStatus;
  title: string | null;
  cover: Record<string, unknown>;
  pdf_url: string | null;
  page_count: number | null;
  error: string | null;
  built_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Extra {
  id: Uuid;
  family_id: Uuid;
  type: "tale" | string;
  status: string;
  data: Record<string, unknown>;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface DemoOrder {
  id: Uuid;
  family_id: Uuid;
  product: "digital" | "print";
  amount_kzt: number;
  extras: string[];
  status: DemoOrderStatus;
  provider: string;
  created_at: IsoDateTime;
  paid_at: IsoDateTime | null;
}

export interface KioskVolunteer {
  id: Uuid;
  name: string;
  active: boolean;
  created_at: IsoDateTime;
}

/** Словарь семьи (#102 / #104): люди, места, слова корё мар из глав книги. */
export type FamilyEntityKind = "person" | "place" | "word";
export type FamilyEntitySource = "auto" | "family";

export interface FamilyEntity {
  id: Uuid;
  family_id: Uuid;
  kind: FamilyEntityKind;
  name_ru: string;
  name_ko: string | null;
  /** Кем ИИ его понял: «сосед, друг детства», «посёлок, где родился рассказчик» */
  description: string | null;
  /** В каких главах встречается */
  story_ids: Uuid[];
  /** auto — заполнила сборка глав; family — поправила семья (автоматика не перезаписывает) */
  source: FamilyEntitySource;
  updated_at: IsoDateTime;
  /** #235 древо: годы жизни (правит семья). Необязательные — до миграции и в фикстурах их нет. */
  birth_year?: number | null;
  death_year?: number | null;
  /** #235 древо: f / m — для подписей «мама / папа»; авто — из слова родства, семья — «он / она». */
  gender?: TreeGender | null;
  /** #235 древо: «это один человек» — на древе запись показывается как same_as (в словаре остаётся). */
  same_as?: Uuid | null;
}

export type TreeGender = "f" | "m";
export type FamilyRelationKind = "parent" | "spouse" | "sibling";

/** #235: ребро древа. parent: from — родитель, to — ребёнок; spouse / sibling — без направления. */
export interface FamilyRelation {
  id: Uuid;
  family_id: Uuid;
  from_entity_id: Uuid;
  to_entity_id: Uuid;
  kind: FamilyRelationKind;
  /** auto — собрала автоматика; family — поправила семья (автоматика человека с такими рёбрами не трогает) */
  source: FamilyEntitySource;
  created_at: IsoDateTime;
}

/** Вопрос из банка (V0 заполняет content/questions/bank.ts). */
export interface Question {
  id: string; // например "childhood-03"
  block: LifeBlock;
  ru: string;
  ko: string;
  /** #230: текст на казахском (пакеты с kk, после флага spoken_kk) */
  kk?: string;
  /** Минимум полноты ответа: «кто», «когда», «где», «что произошло», «живая деталь или чувство» */
  minimum: string[];
}
