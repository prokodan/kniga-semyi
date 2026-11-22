// Клиент GitHub REST (без GraphQL) с кэшем чтения на 60 с.
// Без токена работает «только чтение» по публичному репозиторию; запись бросает GithubReadOnlyError.
import type { GhIssue, GhPull } from "./tasks";

export class GithubReadOnlyError extends Error {
  constructor() {
    super("GITHUB_TOKEN не задан — бот работает только на чтение");
    this.name = "GithubReadOnlyError";
  }
}

export class GithubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

export type Milestone = { number: number; title: string; open_issues: number; closed_issues: number; html_url: string };

export interface GithubApi {
  readonly canWrite: boolean;
  readonly repo: string;
  listIssues(): Promise<GhIssue[]>;
  listPulls(): Promise<GhPull[]>;
  findMilestone(title: string): Promise<Milestone | null>;
  assign(issue: number, login: string): Promise<string[]>;
  unassign(issue: number, login: string): Promise<void>;
  addLabel(issue: number, label: string): Promise<void>;
  removeLabel(issue: number, label: string): Promise<void>;
  dispatch(workflow: string, inputs?: Record<string, string>): Promise<void>;
}

const TTL_MS = 60_000;
type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();

export function clearGithubCache() {
  cache.clear();
}

export function createGithub(opts: {
  repo: string;
  token?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): GithubApi {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const base = `https://api.github.com/repos/${opts.repo}`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (method !== "GET" && !opts.token) throw new GithubReadOnlyError();
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "kniga-semyi-bot",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      // Только код и короткое сообщение GitHub — без заголовков и токена.
      let msg = res.statusText;
      try {
        msg = ((await res.json()) as { message?: string }).message ?? msg;
      } catch {}
      throw new GithubError(res.status, `GitHub ${res.status}: ${msg}`.slice(0, 200));
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async function cachedGet<T>(path: string): Promise<T> {
    const hit = cache.get(`${opts.repo}${path}`);
    if (hit && now() - hit.at < TTL_MS) return hit.value as T;
    const value = await call<T>("GET", path);
    cache.set(`${opts.repo}${path}`, { at: now(), value });
    return value;
  }

  async function pages<T>(path: string, max = 3): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= max; page++) {
      const batch = await cachedGet<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  function invalidate() {
    for (const k of cache.keys()) if (k.startsWith(opts.repo)) cache.delete(k);
  }

  return {
    canWrite: Boolean(opts.token),
    repo: opts.repo,
    listIssues: () => pages<GhIssue>("/issues?state=all"),
    listPulls: () => pages<GhPull>("/pulls?state=all&sort=updated&direction=desc", 1),
    async findMilestone(title) {
      const list = await cachedGet<Milestone[]>("/milestones?state=all&per_page=100");
      return list.find((m) => m.title === title) ?? null;
    },
    async assign(issue, login) {
      const res = await call<{ assignees: { login: string }[] }>("POST", `/issues/${issue}/assignees`, { assignees: [login] });
      invalidate();
      return res.assignees.map((a) => a.login);
    },
    async unassign(issue, login) {
      await call("DELETE", `/issues/${issue}/assignees`, { assignees: [login] });
      invalidate();
    },
    async addLabel(issue, label) {
      await call("POST", `/issues/${issue}/labels`, { labels: [label] });
      invalidate();
    },
    async removeLabel(issue, label) {
      try {
        await call("DELETE", `/issues/${issue}/labels/${encodeURIComponent(label)}`);
      } catch (e) {
        if (!(e instanceof GithubError && e.status === 404)) throw e; // метки и не было
      }
      invalidate();
    },
    async dispatch(workflow, inputs) {
      await call("POST", `/actions/workflows/${workflow}/dispatches`, { ref: "main", ...(inputs ? { inputs } : {}) });
    },
  };
}
