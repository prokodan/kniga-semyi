// #232: хранилище ссылок носителей — Supabase (service-ключ) или память (локально без базы, тесты).
// Без server-only: тот же код читает scripts/reviews-export.ts. Клиент Supabase передаётся снаружи.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewFeedback, ReviewItem, ReviewLink, ReviewMode, ReviewPair, ReviewRatings } from "@/lib/types";
import type { FeedbackInput } from "./core";
import type { ItemSeed } from "./sets";

export interface NewLink {
  token_hash: string;
  pair: ReviewPair;
  mode: ReviewMode;
  reviewer_label: string;
  items_set: string;
  expires_at: string;
}

export interface LinkBundle {
  link: ReviewLink;
  items: ReviewItem[];
  feedback: ReviewFeedback[];
}

export interface ReviewStore {
  createLink(link: NewLink, items: ItemSeed[]): Promise<ReviewLink>;
  revokeLink(id: string): Promise<void>;
  /** Ссылка по хэшу токена (в том числе истёкшая / отозванная — статус решает вызывающий) */
  findByHash(tokenHash: string): Promise<ReviewLink | null>;
  /** Ссылка со всеми текстами и отзывами */
  bundle(link: ReviewLink): Promise<LinkBundle>;
  /** Все ссылки, новые сверху */
  links(): Promise<ReviewLink[]>;
  /** Записать отзыв (одна строка на текст + абзац). false — текст не из этой ссылки. */
  saveFeedback(linkId: string, input: FeedbackInput): Promise<boolean>;
}

const LINK_COLS = "id, pair, mode, reviewer_label, items_set, expires_at, revoked_at, created_at";
const ITEM_COLS = "id, link_id, position, kind, source_lang, target_lang, title, source_text, model_text, prompt_version, persona";
const FB_COLS = "item_id, paragraph, edited_text, ratings, comment, skipped, updated_at";

export class SupabaseReviewStore implements ReviewStore {
  constructor(private readonly db: SupabaseClient) {}

  async createLink(link: NewLink, items: ItemSeed[]): Promise<ReviewLink> {
    const { data, error } = await this.db.from("review_links").insert(link).select(LINK_COLS).single();
    if (error) throw new Error(`review_links: ${error.message}`);
    const created = data as ReviewLink;
    if (items.length) {
      const { error: e2 } = await this.db.from("review_items").insert(items.map((i) => ({ ...i, link_id: created.id })));
      if (e2) {
        await this.db.from("review_links").delete().eq("id", created.id);
        throw new Error(`review_items: ${e2.message}`);
      }
    }
    return created;
  }

  async revokeLink(id: string): Promise<void> {
    const { error } = await this.db.from("review_links").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
    if (error) throw new Error(`review_links: ${error.message}`);
  }

  async findByHash(tokenHash: string): Promise<ReviewLink | null> {
    const { data, error } = await this.db.from("review_links").select(LINK_COLS).eq("token_hash", tokenHash).maybeSingle();
    if (error) throw new Error(`review_links: ${error.message}`);
    return (data as ReviewLink | null) ?? null;
  }

  async bundle(link: ReviewLink): Promise<LinkBundle> {
    const { data: items, error } = await this.db.from("review_items").select(ITEM_COLS).eq("link_id", link.id).order("position");
    if (error) throw new Error(`review_items: ${error.message}`);
    const list = (items ?? []) as ReviewItem[];
    let feedback: ReviewFeedback[] = [];
    if (list.length) {
      const { data: fb, error: e2 } = await this.db.from("review_feedback").select(FB_COLS).in("item_id", list.map((i) => i.id));
      if (e2) throw new Error(`review_feedback: ${e2.message}`);
      feedback = ((fb ?? []) as ReviewFeedback[]).map((f) => ({ ...f, ratings: (f.ratings ?? {}) as ReviewRatings }));
    }
    return { link, items: list, feedback };
  }

  async links(): Promise<ReviewLink[]> {
    const { data, error } = await this.db.from("review_links").select(LINK_COLS).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(`review_links: ${error.message}`);
    return (data ?? []) as ReviewLink[];
  }

  async saveFeedback(linkId: string, input: FeedbackInput): Promise<boolean> {
    const { data: item, error } = await this.db.from("review_items").select("id").eq("id", input.item_id).eq("link_id", linkId).maybeSingle();
    if (error) throw new Error(`review_items: ${error.message}`);
    if (!item) return false;
    const { error: e2 } = await this.db.from("review_feedback").upsert(
      {
        item_id: input.item_id,
        paragraph: input.paragraph,
        edited_text: input.edited_text,
        ratings: input.ratings,
        comment: input.comment,
        skipped: input.skipped,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "item_id,paragraph" },
    );
    if (e2) throw new Error(`review_feedback: ${e2.message}`);
    return true;
  }
}

/** Память процесса: локально без Supabase и в тестах. */
export class MemoryReviewStore implements ReviewStore {
  private readonly linkRows: (ReviewLink & { token_hash: string })[] = [];
  private readonly itemRows: ReviewItem[] = [];
  private readonly fbRows: ReviewFeedback[] = [];

  async createLink(link: NewLink, items: ItemSeed[]): Promise<ReviewLink> {
    const row = { ...link, id: randomUUID(), revoked_at: null, created_at: new Date().toISOString() };
    this.linkRows.push(row);
    for (const i of items) this.itemRows.push({ ...i, id: randomUUID(), link_id: row.id });
    return strip(row);
  }

  async revokeLink(id: string): Promise<void> {
    const l = this.linkRows.find((x) => x.id === id);
    if (l && !l.revoked_at) l.revoked_at = new Date().toISOString();
  }

  async findByHash(tokenHash: string): Promise<ReviewLink | null> {
    const l = this.linkRows.find((x) => x.token_hash === tokenHash);
    return l ? strip(l) : null;
  }

  async bundle(link: ReviewLink): Promise<LinkBundle> {
    const items = this.itemRows.filter((i) => i.link_id === link.id).sort((a, b) => a.position - b.position);
    const ids = new Set(items.map((i) => i.id));
    return { link, items, feedback: this.fbRows.filter((f) => ids.has(f.item_id)).map((f) => ({ ...f })) };
  }

  async links(): Promise<ReviewLink[]> {
    return [...this.linkRows].reverse().map(strip);
  }

  async saveFeedback(linkId: string, input: FeedbackInput): Promise<boolean> {
    if (!this.itemRows.some((i) => i.id === input.item_id && i.link_id === linkId)) return false;
    const row: ReviewFeedback = {
      item_id: input.item_id,
      paragraph: input.paragraph,
      edited_text: input.edited_text,
      ratings: input.ratings,
      comment: input.comment,
      skipped: input.skipped,
      updated_at: new Date().toISOString(),
    };
    const i = this.fbRows.findIndex((f) => f.item_id === input.item_id && f.paragraph === input.paragraph);
    if (i >= 0) this.fbRows[i] = row;
    else this.fbRows.push(row);
    return true;
  }
}

function strip(l: ReviewLink & { token_hash?: string }): ReviewLink {
  const { token_hash: _omit, ...rest } = l;
  void _omit;
  return rest;
}
