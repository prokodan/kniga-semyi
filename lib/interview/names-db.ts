// Источник подсказок имён из базы (пункт 5): карточка рассказчика, название семьи, люди и места прошлых глав.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoryFact } from "@/lib/types";
import { nameHints } from "./names";

export async function loadNameHints(db: SupabaseClient, storytellerId: string): Promise<string[]> {
  const [st, stories] = await Promise.all([
    db.from("storytellers").select("name, birth_place, family_id").eq("id", storytellerId).maybeSingle(),
    db.from("stories").select("facts").eq("storyteller_id", storytellerId).eq("status", "ready").order("created_at", { ascending: false }).limit(30),
  ]);
  const card = st.data as { name?: string; birth_place?: string | null; family_id?: string } | null;
  let familyName: string | null = null;
  if (card?.family_id) {
    const fam = await db.from("families").select("name").eq("id", card.family_id).maybeSingle();
    familyName = (fam.data as { name?: string } | null)?.name ?? null;
  }
  const facts = ((stories.data ?? []) as { facts: StoryFact[] | null }[]).flatMap((s) => s.facts ?? []);
  return nameHints({ storytellerName: card?.name, birthPlace: card?.birth_place, familyName, facts });
}
