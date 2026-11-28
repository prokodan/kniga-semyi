// #353: хранилище ссылок /review 2.0 — те же таблицы review_links / review_items / review_feedback (#232)
// + поля миграции 20261128200000 (kind, criteria, ui_lang, completed_at, focus_terms, item_ref, terms).
// Supabase (service-ключ) или память (локально без базы, тесты). Без server-only: тесты.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewAxis, ReviewFeedback, ReviewItem, ReviewLink, ReviewPair, ReviewRatings } from "@/lib/types";
import type { FeedbackInput } from "@/app/admin/reviews/_lib/core";
import type { CheckKind, FocusTerm, TermVerdicts, UiLang } from "./core";
import type { CheckItemSeed } from "./materials";

export interface CheckLink extends ReviewLink {
  /** null — старая ссылка #232 */
  kind: CheckKind | null;
  criteria: ReviewAxis[] | null;
  ui_lang: UiLang | null;
  completed_at: string | null;
}
export interface CheckItem extends ReviewItem {
  focus_terms: FocusTerm[] | null;
  item_ref: string | null;
}
export interface CheckFeedback extends ReviewFeedback {
  terms: TermVerdicts;
}
export interface CheckBundle {
  link: CheckLink;
  items: CheckItem[];
  feedback: CheckFeedback[];
}

export interface NewCheckLink {
  token_hash: string;
  pair: ReviewPair;
  kind: CheckKind;
  criteria: ReviewAxis[];
  ui_lang: UiLang;
  reviewer_label: string;
  items_set: string;
  expires_at: string;
}

export type CheckFeedbackInput = FeedbackInput & { terms: TermVerdicts | null };

export interface CheckStore {
  createLink(link: NewCheckLink, items: CheckItemSeed[]): Promise<CheckLink>;
  findByHash(tokenHash: string): Promise<CheckLink | null>;
  bundle(link: CheckLink): Promise<CheckBundle>;
  links(): Promise<CheckLink[]>;
  /** false — текст не из этой ссылки */
  saveFeedback(linkId: string, input: CheckFeedbackInput): Promise<boolean>;
  complete(linkId: string): Promise<void>;
  revoke(linkId: string): Promise<void>;
}

const LINK_COLS = "id, pair, mode, kind, criteria, ui_lang, reviewer_label, items_set, expires_at, revoked_at, completed_at, created_at";
const ITEM_COLS =
  "id, link_id, position, kind, source_lang, target_lang, title, source_text, model_text, prompt_version, persona, focus_terms, item_ref";
const FB_COLS = "item_id, paragraph, edited_text, ratings, comment, skipped, terms, updated_at";

const fbRow = (f: CheckFeedback): CheckFeedback => ({ ...f, ratings: (f.ratings ?? {}) as ReviewRatings, terms: (f.terms ?? {}) as TermVerdicts });

export class SupabaseCheckStore implements CheckStore {
  constructor(private readonly db: SupabaseClient) {}

  async createLink(link: NewCheckLink, items: CheckItemSeed[]): Promise<CheckLink> {
    const { data, error } = await this.db
      .from("review_links")
      .insert({ ...link, mode: "texts" })
      .select(LINK_COLS)
      .single();
    if (error) throw new Error(`review_links: ${error.message}`);
    const created = data as CheckLink;
    if (items.length) {
      const { error: e2 } = await this.db.from("review_items").insert(items.map((i) => ({ ...i, link_id: created.id })));
      if (e2) {
        await this.db.from("review_links").delete().eq("id", created.id);
        throw new Error(`review_items: ${e2.message}`);
      }
    }
    return created;
  }

  async findByHash(tokenHash: string): Promise<CheckLink | null> {
    const { data, error } = await this.db.from("review_links").select(LINK_COLS).eq("token_hash", tokenHash).maybeSingle();
    if (error) throw new Error(`review_links: ${error.message}`);
    return (data as CheckLink | null) ?? null;
  }

  async bundle(link: CheckLink): Promise<CheckBundle> {
    const { data: items, error } = await this.db.from("review_items").select(ITEM_COLS).eq("link_id", link.id).order("position");
    if (error) throw new Error(`review_items: ${error.message}`);
    const list = (items ?? []) as CheckItem[];
    let feedback: CheckFeedback[] = [];
    if (list.length) {
      const { data: fb, error: e2 } = await this.db.from("review_feedback").select(FB_COLS).in("item_id", list.map((i) => i.id));
      if (e2) throw new Error(`review_feedback: ${e2.message}`);
      feedback = ((fb ?? []) as CheckFeedback[]).map(fbRow);
    }
    return { link, items: list, feedback };
  }

  async links(): Promise<CheckLink[]> {
    const { data, error } = await this.db.from("review_links").select(LINK_COLS).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(`review_links: ${error.message}`);
    return (data ?? []) as CheckLink[];
  }

  async saveFeedback(linkId: string, input: CheckFeedbackInput): Promise<boolean> {
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
        terms: input.terms ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "item_id,paragraph" },
    );
    if (e2) throw new Error(`review_feedback: ${e2.message}`);
    return true;
  }

  async complete(linkId: string): Promise<void> {
    const { error } = await this.db.from("review_links").update({ completed_at: new Date().toISOString() }).eq("id", linkId).is("completed_at", null);
    if (error) throw new Error(`review_links: ${error.message}`);
  }

  async revoke(linkId: string): Promise<void> {
    const { error } = await this.db.from("review_links").update({ revoked_at: new Date().toISOString() }).eq("id", linkId).is("revoked_at", null);
    if (error) throw new Error(`review_links: ${error.message}`);
  }
}

/** Память процесса: локально без Supabase и в тестах. */
export class MemoryCheckStore implements CheckStore {
  private readonly linkRows: (CheckLink & { token_hash: string })[] = [];
  private readonly itemRows: CheckItem[] = [];
  private readonly fbRows: CheckFeedback[] = [];

  async createLink(link: NewCheckLink, items: CheckItemSeed[]): Promise<CheckLink> {
    const row = { ...link, mode: "texts" as const, id: randomUUID(), revoked_at: null, completed_at: null, created_at: new Date().toISOString() };
    this.linkRows.push(row);
    for (const i of items) this.itemRows.push({ ...i, id: randomUUID(), link_id: row.id });
    return strip(row);
  }

  async findByHash(tokenHash: string): Promise<CheckLink | null> {
    const l = this.linkRows.find((x) => x.token_hash === tokenHash);
    return l ? strip(l) : null;
  }

  async bundle(link: CheckLink): Promise<CheckBundle> {
    const items = this.itemRows.filter((i) => i.link_id === link.id).sort((a, b) => a.position - b.position);
    const ids = new Set(items.map((i) => i.id));
    return { link, items, feedback: this.fbRows.filter((f) => ids.has(f.item_id)).map((f) => fbRow({ ...f })) };
  }

  async links(): Promise<CheckLink[]> {
    return [...this.linkRows].reverse().map(strip);
  }

  async saveFeedback(linkId: string, input: CheckFeedbackInput): Promise<boolean> {
    if (!this.itemRows.some((i) => i.id === input.item_id && i.link_id === linkId)) return false;
    const row: CheckFeedback = {
      item_id: input.item_id,
      paragraph: input.paragraph,
      edited_text: input.edited_text,
      ratings: input.ratings,
      comment: input.comment,
      skipped: input.skipped,
      terms: input.terms ?? {},
      updated_at: new Date().toISOString(),
    };
    const i = this.fbRows.findIndex((f) => f.item_id === input.item_id && f.paragraph === input.paragraph);
    if (i >= 0) this.fbRows[i] = row;
    else this.fbRows.push(row);
    return true;
  }

  async complete(linkId: string): Promise<void> {
    const l = this.linkRows.find((x) => x.id === linkId);
    if (l && !l.completed_at) l.completed_at = new Date().toISOString();
  }

  async revoke(linkId: string): Promise<void> {
    const l = this.linkRows.find((x) => x.id === linkId);
    if (l && !l.revoked_at) l.revoked_at = new Date().toISOString();
  }
}

function strip(l: CheckLink & { token_hash?: string }): CheckLink {
  const { token_hash: _omit, ...rest } = l;
  void _omit;
  return rest;
}
