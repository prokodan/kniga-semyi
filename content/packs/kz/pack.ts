// Слой kz — казахская культура (#231 — только то, что нужно переводу ru ↔ kk: глоссарий, родство, обращение).
// Вопросы (add / reword / minimum+), тексты kk для general и выбор пакетов на /start — #233 (флаг culture_packs).
// Пока ops пустые: семья с culture_packs {general,kz} слышит ровно костяк general.
import type { CulturePack } from "../types";
import { KZ_GLOSSARY, KZ_KINSHIP, KZ_TONE } from "./glossary";

export const KZ_PACK: CulturePack = {
  id: "kz",
  title: "Казахская культура",
  ops: [],
  glossary: { words: KZ_GLOSSARY.map((t) => ({ term: t.kk, meaning: t.meaning })) },
  kinship: KZ_KINSHIP,
  hints: KZ_GLOSSARY.filter((t) => t.section === "place").map((t) => t.kk),
  tone: KZ_TONE,
};
