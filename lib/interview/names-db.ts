// Источник подсказок имён из базы (пункт 5): словарь семьи (family_entities, #102), карточка рассказчика,
// название семьи, люди и места прошлых глав.
import type { SupabaseClient } from "@supabase/supabase-js";
import { rankEntities } from "@/lib/pipeline/entities";
import type { Family, FamilyEntity, StoryFact } from "@/lib/types";
import { familyPacks } from "./bank";
import { nameHints } from "./names";

/**
 * `packsOn` — #233: включён ли флаг culture_packs семье (lib/flags — server-only, поэтому снаружи). Нет / выключен —
 * подсказки как сейчас (корё мар, топонимы, фамилии); включён — по пакетам семьи (families.culture_packs).
 */
export async function loadNameHints(
  db: SupabaseClient,
  storytellerId: string,
  packsOn?: (family: Pick<Family, "id" | "labs">) => boolean,
): Promise<string[]> {
  const [st, stories] = await Promise.all([
    db.from("storytellers").select("name, birth_place, family_id").eq("id", storytellerId).maybeSingle(),
    db.from("stories").select("facts").eq("storyteller_id", storytellerId).eq("status", "ready").order("created_at", { ascending: false }).limit(30),
  ]);
  const card = st.data as { name?: string; birth_place?: string | null; family_id?: string } | null;
  let familyName: string | null = null;
  let entities: string[] = [];
  let packs: string[] | null = null;
  if (card?.family_id) {
    const [fam, ents] = await Promise.all([
      // "*": culture_packs / labs — колонки миграций #230 / #223; до них просто нет поля
      db.from("families").select("*").eq("id", card.family_id).maybeSingle(),
      db.from("family_entities").select("name_ru, source, story_ids, updated_at").eq("family_id", card.family_id).limit(300),
    ]);
    const family = fam.data as (Pick<Family, "id" | "name" | "labs" | "culture_packs"> & { id: string }) | null;
    familyName = family?.name ?? null;
    if (family && packsOn) packs = familyPacks(family, packsOn(family));
    // нет таблицы (миграция ещё не применена) или ошибка — просто без словаря
    if (!ents.error) entities = rankEntities((ents.data ?? []) as Pick<FamilyEntity, "name_ru" | "source" | "story_ids" | "updated_at">[]).map((e) => e.name_ru);
  }
  const facts = ((stories.data ?? []) as { facts: StoryFact[] | null }[]).flatMap((s) => s.facts ?? []);
  return nameHints({ storytellerName: card?.name, birthPlace: card?.birth_place, familyName, facts, entities }, packs);
}
