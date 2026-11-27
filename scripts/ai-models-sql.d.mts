// Типы для scripts/ai-models-sql.mjs (скрипт workflow — без сборки, тест — на TypeScript).
export interface RouteEntryJson {
  provider: string;
  model: string;
  daily_limit?: number;
  threshold?: number;
}
export function withoutGeminiQuotas(list: RouteEntryJson[]): RouteEntryJson[];
export function routesSql(routes: Record<string, RouteEntryJson[]>, timeouts: Record<string, number>): string;
