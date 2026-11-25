import { BLOCKS } from "@/content/questions/blocks";
import type { LifeBlock } from "@/lib/types";
import { blockState, progressLine, type InterviewProgressView } from "./progress-line";

const ORDER = BLOCKS.map((b) => b.id);

// #101: полоса разделов интервью — текущий раздел жёлтым акцентом (gold), пройденные ✓, будущие приглушённо;
// под ней строка «Вопрос 2 из 5 в разделе „Детство“ · уточнение 1 из 3». large — крупно для киоска.
export function InterviewProgress({
  current,
  progress,
  kind,
  large = false,
}: {
  current: { block: LifeBlock; title: string } | null;
  progress?: InterviewProgressView | null;
  kind: "question" | "followup";
  large?: boolean;
}) {
  const done = progress?.doneBlocks ?? [];
  const line = current ? progressLine(progress, kind, current.title) : null;
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex gap-1" aria-label="Разделы книги">
        {BLOCKS.map((b) => {
          const st = blockState(b.id, ORDER, current?.block ?? null, done);
          const cls =
            st === "current"
              ? "bg-gold text-paper font-semibold ring-2 ring-gold/40"
              : st === "done"
                ? "bg-jade text-paper"
                : "bg-line text-muted";
          return (
            <li
              key={b.id}
              title={b.ru}
              aria-current={st === "current" ? "step" : undefined}
              aria-label={`${b.ru}: ${st === "current" ? "сейчас" : st === "done" ? "пройден" : "впереди"}`}
              className={`flex flex-1 items-center justify-center rounded-full ${large ? "h-9 text-lg" : "h-6 text-sm"} ${cls}`}
            >
              {st === "done" ? "✓" : st === "current" ? ORDER.indexOf(b.id) + 1 : ""}
            </li>
          );
        })}
      </ol>
      {line && (
        <p className={large ? "text-elder text-ink" : "text-base text-ink"} aria-live="polite">
          {line}
        </p>
      )}
    </div>
  );
}
