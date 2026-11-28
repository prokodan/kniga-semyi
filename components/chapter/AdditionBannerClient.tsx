"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ADDITION_TEXT as T, type AdditionView } from "./addition";

// #320: кнопка плашки → POST /api/stories/:id/process { from: "edit" } → страница обновляется и показывает сборку.
export function AdditionBannerClient(props: { storyId: string; token: string; place: "chapter" | "draft"; view: AdditionView }) {
  const { storyId, token, place, view } = props;
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "failed">("idle");

  async function rebuild() {
    if (view.edited && state !== "confirm") {
      setState("confirm");
      return;
    }
    setState("busy");
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/process`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-token": token },
        body: JSON.stringify({ from: "edit" }),
      });
      if (!res.ok && res.status !== 202) throw new Error(String(res.status));
      // глава снова собирается: на /chapter — экран ожидания, на /draft — «Глава ещё собирается»
      router.refresh();
    } catch {
      setState("failed");
    }
  }

  const draftUrl = `/draft/${storyId}?token=${encodeURIComponent(token)}`;
  return (
    <section role="status" className="flex flex-col gap-4 rounded-card border border-line bg-paper-deep p-5 shadow-card">
      <div className="flex flex-col gap-1">
        <p className="font-serif text-xl">✦ {T.title}</p>
        <p className="text-ink-soft">{T.lead}</p>
      </div>
      <blockquote className="border-l-4 border-seal pl-4 text-elder">
        {view.question && <p className="text-sm text-muted">{view.question}</p>}
        <p>{view.answer}</p>
      </blockquote>
      <p className="text-sm text-ink-soft">{view.edited ? T.edited : T.plain}</p>
      {state === "confirm" && <p className="font-semibold">{T.confirm}</p>}
      {state === "failed" && <p className="text-danger">{T.failed}</p>}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void rebuild()}
          disabled={state === "busy"}
          className="min-h-12 rounded-button bg-seal px-5 py-3 font-semibold text-paper disabled:opacity-60"
        >
          {state === "busy" ? T.busy : view.edited && state === "confirm" ? T.editedRebuild : T.rebuild}
        </button>
        {view.edited && place === "chapter" && (
          <Link href={draftUrl} className="inline-flex min-h-12 items-center justify-center rounded-button border border-line bg-paper px-5 py-3 text-ink-soft">
            {T.byHand}
          </Link>
        )}
      </div>
    </section>
  );
}
