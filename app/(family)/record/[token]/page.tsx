import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { blockProgress, getFamilyByToken } from "@/lib/db/access";
import { LinkNotFound } from "../../_ui/LinkNotFound";
import { RecordFlow } from "./RecordFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Запись рассказа · Книга семьи", robots: { index: false, follow: false } };

// Экран записи по вопросам. Без голосового согласия — сначала на /consent.
export default async function RecordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getFamilyByToken(token);
  if (!view || !view.storyteller) return <LinkNotFound />;
  const st = view.storyteller;
  if (!st.consent_at) redirect(`/consent/${token}`);

  const mine = view.stories.filter((s) => s.storyteller_id === st.id && !s.parent_story_id);
  const answered = [...new Set(mine.map((s) => s.question_id).filter((q): q is string => Boolean(q)))];

  return (
    <RecordFlow
      token={token}
      familyId={view.family.id}
      storyteller={{ id: st.id, name: st.name }}
      initialCovered={blockProgress(view.stories, st.id).covered}
      answeredQuestionIds={answered}
    />
  );
}
