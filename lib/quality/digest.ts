// #354 (docs/v2/QUALITY_LOOP.md §5.2): quality-digest — новые отзывы проверяющих → шаг ИИ quality_analyze (самая
// сильная модель OpenAI) → quality_findings по компонентам и важности, дубли сливаются (lib/quality/findings.ts).
// Запуск: pg_cron раз в час (/api/cron/quality-digest), проверяющий нажал «Готово» (/api/review/check, after()),
// кнопка «Разобрать сейчас» во вкладке «Находки», workflow quality-propose (action digest | selftest).
// После разбора: где новых находок одного компонента ≥ 3 — запускаем quality-propose (dispatch), если он передан.
// Лимит: QUALITY_DIGEST_DAILY_USD (по умолчанию $3) на шаг quality_analyze за последние 24 ч; дедлайн вызова — у
// функции 60 с. Только вымышленные тексты (ссылки строятся из банка / eval / демо) и только где включён quality_loop.
import type { AiRouter, RunOptions } from "@/lib/ai/router";
import type { AiOutput } from "@/lib/ai/types";
import type { DigestRepo } from "./digest-repo";
import {
  AUTO_PROPOSE_MIN,
  analyzeInput,
  autoProposeGroups,
  buildUnit,
  draftsFrom,
  feedbackAt,
  planMerge,
  type FindingComponent,
  type QualityDigest,
  type ReviewUnit,
} from "./findings";

/** Лимит $ на разбор в сутки по умолчанию (issue #354) */
export const DIGEST_DAILY_USD = 3;
/** Текстов в одном вызове quality_analyze (контракт — до 6; 4 — чтобы ответ модели уложился в 45 с) */
export const DIGEST_BATCH = 4;
/** Меньше стольких мс до дедлайна — новый вызов ИИ не начинаем */
const MIN_CALL_MS = 15_000;

export function digestDailyUsd(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.QUALITY_DIGEST_DAILY_USD);
  return env.QUALITY_DIGEST_DAILY_USD && Number.isFinite(v) && v >= 0 ? v : DIGEST_DAILY_USD;
}

export interface DigestDeps {
  repo: DigestRepo;
  ai: Pick<AiRouter, "run">;
  trigger: "cron" | "link" | "button" | "workflow" | "selftest";
  /** Только эта ссылка (закрытие ссылки) */
  linkId?: string;
  /** Момент (мс epoch), к которому всё уложить; не задан — без ограничения (workflow) */
  deadline?: number;
  dailyUsd?: number;
  now?: () => Date;
  /** Запустить quality-propose для (пара, компонент); не передан — авто-предложения нет (локально / тесты без GitHub) */
  dispatchPropose?: (pair: string, component: FindingComponent) => Promise<void>;
  autoMin?: number;
  log?: (line: string) => void;
}

export interface DigestResult {
  status: QualityDigest["status"] | "busy";
  digestId: string | null;
  itemsSeen: number;
  itemsAnalyzed: number;
  findingsNew: number;
  findingsMerged: number;
  calls: number;
  costUsd: number;
  proposed: { pair: string; component: string; count: number }[];
  errors: string[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runDigest(deps: DigestDeps): Promise<DigestResult> {
  const { repo, ai } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const daily = deps.dailyUsd ?? digestDailyUsd();
  const res: DigestResult = { status: "ok", digestId: null, itemsSeen: 0, itemsAnalyzed: 0, findingsNew: 0, findingsMerged: 0, calls: 0, costUsd: 0, proposed: [], errors: [] };

  const digest = await repo.startDigest(deps.trigger);
  if (!digest) return { ...res, status: "busy" };
  res.digestId = digest.id;
  const daySince = () => new Date(now().getTime() - 24 * 3600_000);
  const spentAtStart = await repo.spentSince(daySince());

  try {
    const raw = await repo.reviewUnits({ linkId: deps.linkId });
    const seen = await repo.seen(raw.map((r) => r.item.id));
    const fresh = raw.filter((r) => {
      const at = feedbackAt(r.feedback);
      const was = seen.get(r.item.id);
      return at && (!was || Date.parse(at) > Date.parse(was));
    });
    res.itemsSeen = fresh.length;
    // нечего разбирать (одни оценки без замечаний / «пропустить») — отмечаем без ИИ
    const units: ReviewUnit[] = [];
    const quiet: { item_id: string; feedback_at: string; digest_id: string; findings: number }[] = [];
    for (const r of fresh) {
      const u = buildUnit(r);
      if (u) units.push(u);
      else quiet.push({ item_id: r.item.id, feedback_at: feedbackAt(r.feedback)!, digest_id: digest.id, findings: 0 });
    }
    await repo.markSeen(quiet);
    if (!units.length) {
      res.status = "idle";
      return res;
    }

    // пачки по паре: старые отзывы первыми
    units.sort((a, b) => a.pair.localeCompare(b.pair) || a.feedback_at.localeCompare(b.feedback_at));
    const batches: ReviewUnit[][] = [];
    for (const u of units) {
      const last = batches.at(-1);
      if (last && last[0]!.pair === u.pair && last.length < DIGEST_BATCH) last.push(u);
      else batches.push([u]);
    }

    const touchedGroups = new Set<string>();
    for (const batch of batches) {
      if (deps.deadline && deps.deadline - Date.now() < MIN_CALL_MS) {
        res.status = "partial";
        res.errors.push("не успели в лимит функции — остальное разберёт следующий запуск");
        break;
      }
      const spent = await repo.spentSince(daySince());
      if (spent >= daily) {
        res.status = "budget";
        res.errors.push(`лимит разбора $${daily} за сутки исчерпан ($${spent.toFixed(2)})`);
        break;
      }
      const pair = batch[0]!.pair;
      const known = await repo.findings({ pair, statuses: ["new", "proposed"] });
      let out: AiOutput<"quality_analyze">;
      try {
        const opts: RunOptions = deps.deadline ? { deadline: deps.deadline } : {};
        out = await ai.run("quality_analyze", analyzeInput(batch, known), opts);
        res.calls += 1;
      } catch (e) {
        res.calls += 1;
        res.status = "partial";
        res.errors.push(`quality_analyze: ${errText(e)}`);
        log(`[quality-digest] вызов не удался: ${errText(e)}`);
        continue; // тексты пачки не отмечаем — разберём в следующий раз
      }
      const drafts = draftsFrom(batch, out, digest.id);
      const all = await repo.findings({ pair });
      const plan = planMerge(all, drafts);
      const created = await repo.insertFindings(plan.create);
      for (const u of plan.update) await repo.updateFinding(u.id, { ...u.patch, digest_id: digest.id });
      res.findingsNew += created.length;
      res.findingsMerged += plan.update.length;
      res.itemsAnalyzed += batch.length;
      for (const d of [...plan.create, ...plan.update.map((x) => x.patch)]) touchedGroups.add(`${d.pair}|${d.component}`);
      const perItem = new Map<string, number>();
      for (const { draft } of drafts) perItem.set(draft.item_ids[0]!, (perItem.get(draft.item_ids[0]!) ?? 0) + 1);
      await repo.markSeen(batch.map((u) => ({ item_id: u.item_id, feedback_at: u.feedback_at, digest_id: digest.id, findings: perItem.get(u.item_id) ?? 0 })));
      log(`[quality-digest] ${pair}: текстов ${batch.length} → новых находок ${created.length}, слито ${plan.update.length}`);
    }

    // авто-предложение: ≥ N новых находок одного компонента в паре, и в этом разборе по группе что-то нашли
    if (deps.dispatchPropose) {
      const open = await repo.findings({ statuses: ["new"] });
      for (const g of autoProposeGroups(open, deps.autoMin ?? AUTO_PROPOSE_MIN)) {
        if (!touchedGroups.has(`${g.pair}|${g.component}`)) continue;
        try {
          await deps.dispatchPropose(g.pair, g.component);
          res.proposed.push(g);
        } catch (e) {
          res.errors.push(`quality-propose ${g.pair} ${g.component}: ${errText(e)}`);
        }
      }
    }
    return res;
  } catch (e) {
    res.status = "error";
    res.errors.push(errText(e));
    return res;
  } finally {
    res.costUsd = Math.max(0, (await repo.spentSince(daySince()).catch(() => spentAtStart)) - spentAtStart);
    await repo
      .finishDigest(digest.id, {
        status: res.status === "busy" ? "error" : res.status,
        items_seen: res.itemsSeen,
        items_analyzed: res.itemsAnalyzed,
        findings_new: res.findingsNew,
        findings_merged: res.findingsMerged,
        calls: res.calls,
        cost_usd: Number(res.costUsd.toFixed(4)),
        proposed: res.proposed,
        error: res.errors.join("; ").slice(0, 1000) || null,
      })
      .catch(() => undefined);
  }
}
