// #98: из чего собирается глава. Инвариант «один записанный ответ → ровно одна глава»:
//  1) глава = основной ответ + ответы на его уточнения, в том числе записи-уточнения (parent_story_id), которые
//     интервью не успело приклеить (расшифровка дольше ожидания телефона → «пропустить»). Раньше такой ответ
//     терялся: сам он главой не становится, а в followups основной не попадал;
//  2) рассказ, который рассказчик уже рассказал в более ранней главе (буран в «Работе» и в «Трудных временах»),
//     второй раз в главу не идёт: повторённые предложения выпадают из источника более поздней главы. Иначе одна
//     история оказывается в двух главах, да ещё с разными годами.
// Здесь только чистые функции — тесты без базы и ИИ.
import type { FollowUp, Story } from "@/lib/types";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
export const words = (s: string | null | undefined): string[] => norm(s ?? "").match(/[\p{L}\p{N}]+/gu) ?? [];

export function shingles(s: string, n = 3): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  if (w.length > 0 && w.length < n) out.add(w.join(" "));
  return out;
}

/** Доля фрагментов a, которые есть в b (0..1). */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return hit / a.size;
}

/** Ответ уже есть среди уточнений истории (по id записи или по тексту). */
export function represented(followups: FollowUp[], child: { id: string; transcript: string | null }): boolean {
  if (followups.some((f) => f.story_id === child.id)) return true;
  const mine = shingles(child.transcript ?? "");
  if (mine.size === 0) return true; // пустой ответ добавлять нечего
  return followups.some((f) => containment(mine, shingles(f.answer)) >= 0.8);
}

/**
 * Записи-уточнения, которых нет в followups основной истории → добавить в конец (по времени записи).
 * Отказы и переспросы имени интервью помечает skipped — они в главу не идут.
 */
export function attachChildren(
  followups: FollowUp[],
  children: Pick<Story, "id" | "transcript" | "status" | "created_at">[],
): { followups: FollowUp[]; added: number } {
  const out = [...followups];
  let added = 0;
  for (const c of [...children].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (c.status === "skipped" || !c.transcript?.trim()) continue;
    if (represented(out, c)) continue;
    out.push({ question: "", answer: c.transcript.trim(), story_id: c.id });
    added++;
  }
  return { followups: out, added };
}

/** Предложения (с сохранением знаков). Расшифровка без точек — одно «предложение». */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]*["»”)]?\s*/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Предложение короче — не считаем повтором («Я работал шофёром.» бывает в разных ответах). */
export const REPEAT_MIN_WORDS = 7;
/** Доля 3-словных фрагментов предложения, найденных в одной более ранней главе, — это повтор. */
export const REPEAT_SHARE = 0.6;

export interface Deduped {
  /** Части источника без повторов: [основной ответ, ответ на уточнение 1, …] */
  parts: string[];
  /** Сколько предложений выпало и из каких историй они уже рассказаны */
  dropped: number;
  repeatsOf: string[];
}

/**
 * Убрать из частей ответа предложения, которые рассказчик уже рассказал в более ранней главе
 * (source — её основной ответ и уточнения).
 */
export function dropRepeats(parts: string[], earlier: { id: string; source: string }[]): Deduped {
  const sets = earlier.map((e) => ({ id: e.id, set: shingles(e.source) }));
  const repeatsOf = new Set<string>();
  let dropped = 0;
  const out = parts.map((p) => {
    const kept: string[] = [];
    // Короткое предложение сразу после выпавшего — продолжение того же рассказа («Это был 84-й год.»):
    // без него оно теряет смысл и тащит в главу второй, противоречащий год.
    let afterDrop = false;
    for (const s of sentences(p)) {
      const n = words(s).length;
      if (n >= REPEAT_MIN_WORDS) {
        const mine = shingles(s);
        const hit = sets.find((e) => containment(mine, e.set) >= REPEAT_SHARE);
        if (hit) {
          dropped++;
          repeatsOf.add(hit.id);
          afterDrop = true;
          continue;
        }
        afterDrop = false;
      } else if (afterDrop) {
        dropped++;
        afterDrop = false; // только одно короткое продолжение
        continue;
      }
      kept.push(s);
    }
    return kept.join(" ").trim();
  });
  return { parts: out, dropped, repeatsOf: [...repeatsOf] };
}

/** Источник главы для edit: части через пустую строку (как раньше editSource). */
export const joinParts = (parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join("\n\n");

/** Источник истории целиком (для сравнения с более поздними главами). */
export const fullSource = (s: Pick<Story, "transcript" | "followups">) =>
  joinParts([s.transcript ?? "", ...(s.followups ?? []).map((f) => f.answer)]);
