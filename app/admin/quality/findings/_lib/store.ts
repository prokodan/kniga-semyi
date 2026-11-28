import "server-only";
// #354: разбор отзывов для /admin/quality/findings, /api/cron/quality-digest и /api/review/check — Supabase (service-ключ)
// или память (локально без базы). quality-propose запускается через GitHub Actions (GITHUB_TOKEN, как «Прогнать» #362).
import { ai } from "@/lib/ai";
import { createGithub } from "@/lib/bot/github";
import { getDbOrNull } from "@/lib/db";
import { flag } from "@/lib/flags";
import { runDigest, type DigestDeps, type DigestResult } from "@/lib/quality/digest";
import { MemoryDigestRepo, SupabaseDigestRepo, type DigestRepo } from "@/lib/quality/digest-repo";
import type { FindingComponent } from "@/lib/quality/findings";

type G = { __digestMemory?: MemoryDigestRepo };

export function digestRepo(): { repo: DigestRepo; memory: boolean } {
  const db = getDbOrNull();
  if (db) return { repo: new SupabaseDigestRepo(db), memory: false };
  const g = globalThis as G;
  g.__digestMemory ??= new MemoryDigestRepo();
  return { repo: g.__digestMemory, memory: true };
}

export const QUALITY_PROPOSE_WORKFLOW = "quality-propose.yml";
export const QUALITY_PROPOSE_URL = "https://github.com/prokodan/kniga-semyi/actions/workflows/quality-propose.yml";

/** Есть ли чем запускать quality-propose с этого окружения */
export const canDispatch = () => Boolean(process.env.GITHUB_TOKEN);

/** Запуск workflow quality-propose (staging) для пары и, если задан, одного компонента. */
export async function dispatchPropose(pair: string, component: FindingComponent | "", trigger: "button" | "auto"): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("нет GITHUB_TOKEN");
  const gh = createGithub({ repo: process.env.GITHUB_REPO ?? "prokodan/kniga-semyi", token });
  await gh.dispatch(QUALITY_PROPOSE_WORKFLOW, { action: "propose", target: "staging", pair, component, trigger });
}

/** Разбор с роутером ИИ сайта; авто-предложение — если есть GITHUB_TOKEN. Флаг выключен — ничего не делаем. */
export async function digestNow(trigger: DigestDeps["trigger"], opts: { linkId?: string; deadline?: number } = {}): Promise<DigestResult | null> {
  if (!flag("quality_loop")) return null;
  const { repo } = digestRepo();
  return runDigest({
    repo,
    ai,
    trigger,
    linkId: opts.linkId,
    deadline: opts.deadline,
    dispatchPropose: canDispatch() ? (pair, component) => dispatchPropose(pair, component, "auto") : undefined,
    log: (l) => console.log(l),
  });
}
