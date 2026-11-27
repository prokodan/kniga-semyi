import "server-only";
// #232: точки входа ссылок носителей для страниц и API. Токен — только в ответе на создание и в адресе ссылки;
// в базе и в логах — никогда (в логи — только id ссылки).
import { getDbOrNull } from "@/lib/db";
import type { ReviewLink, ReviewMode, ReviewPair } from "@/lib/types";
import { TOKEN_RE, hashReviewToken, linkStatus, newReviewToken, reviewerLabel } from "./core";
import { MemoryReviewStore, SupabaseReviewStore, type LinkBundle, type ReviewStore } from "./repo";
import { findSet } from "./sets";

type G = { __reviewMemory?: MemoryReviewStore };

export function reviewStore(): { store: ReviewStore; memory: boolean } {
  const db = getDbOrNull();
  if (db) return { store: new SupabaseReviewStore(db), memory: false };
  const g = globalThis as G;
  g.__reviewMemory ??= new MemoryReviewStore();
  return { store: g.__reviewMemory, memory: true };
}

export class ReviewLinkError extends Error {}

export async function createReviewLink(input: {
  pair: ReviewPair;
  mode: ReviewMode;
  setId: string;
  reviewer: string;
  days: number;
}): Promise<{ token: string; link: ReviewLink; items: number }> {
  const set = findSet(input.setId);
  if (!set || set.mode !== input.mode || !set.pairs.includes(input.pair)) throw new ReviewLinkError("Этот набор не подходит к паре и режиму.");
  const items = set.items(input.pair);
  if (!items.length) throw new ReviewLinkError("Для этой пары в наборе пока нет текстов.");
  const label = reviewerLabel(input.reviewer);
  if (!label) throw new ReviewLinkError("Укажите инициалы проверяющего.");
  const days = Math.min(90, Math.max(1, Math.round(input.days)));
  const token = newReviewToken();
  const link = await reviewStore().store.createLink(
    {
      token_hash: hashReviewToken(token),
      pair: input.pair,
      mode: input.mode,
      reviewer_label: label,
      items_set: set.id,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    },
    items,
  );
  return { token, link, items: items.length };
}

/** Ссылка по токену из адреса: null — нет такой; статус — активна / истекла / отозвана. */
export async function openReview(token: string): Promise<{ status: "missing" } | { status: "active" | "expired" | "revoked"; bundle?: LinkBundle; link: ReviewLink }> {
  if (!TOKEN_RE.test(token)) return { status: "missing" };
  const { store } = reviewStore();
  const link = await store.findByHash(hashReviewToken(token));
  if (!link) return { status: "missing" };
  const status = linkStatus(link);
  if (status !== "active") return { status, link };
  return { status, link, bundle: await store.bundle(link) };
}
