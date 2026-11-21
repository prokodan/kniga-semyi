import { BLOCKS } from "@/content/questions/blocks";
import type { LifeBlock } from "@/lib/types";

// Прогресс по блокам карты жизни: «3 из 8» + восемь отметок.
export function BlockProgress({ covered, compact = false }: { covered: readonly LifeBlock[]; compact?: boolean }) {
  const set = new Set(covered);
  return (
    <div className="flex flex-col gap-2">
      <p className={compact ? "text-sm text-muted" : "text-ink-soft"}>
        Глав начато: <b className="text-ink">{set.size} из {BLOCKS.length}</b>
      </p>
      <ol className="flex gap-1.5" aria-label="Блоки книги">
        {BLOCKS.map((b) => (
          <li
            key={b.id}
            title={b.ru}
            className={`h-2 flex-1 rounded-full ${set.has(b.id) ? "bg-jade" : "bg-line"}`}
            aria-label={`${b.ru}: ${set.has(b.id) ? "есть рассказ" : "пока нет"}`}
          />
        ))}
      </ol>
      {!compact && (
        <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {BLOCKS.map((b) => (
            <li key={b.id} className={set.has(b.id) ? "text-ink" : "text-muted"}>
              {set.has(b.id) ? "✓ " : "○ "}
              {b.ru}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
