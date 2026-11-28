import "server-only";
// #352: банк проверок для страниц /admin/quality — Supabase (service-ключ) или память (локально без базы).
import { getDbOrNull } from "@/lib/db";
import { MemoryQualityRepo, SupabaseQualityRepo, type QualityRepo } from "@/lib/quality/repo";

type G = { __qualityMemory?: MemoryQualityRepo };

export function qualityRepo(): { repo: QualityRepo; memory: boolean } {
  const db = getDbOrNull();
  if (db) return { repo: new SupabaseQualityRepo(db), memory: false };
  const g = globalThis as G;
  g.__qualityMemory ??= new MemoryQualityRepo();
  return { repo: g.__qualityMemory, memory: true };
}

export const QUALITY_RUN_WORKFLOW = "quality-run.yml";
export const QUALITY_RUN_URL = "https://github.com/prokodan/kniga-semyi/actions/workflows/quality-run.yml";
