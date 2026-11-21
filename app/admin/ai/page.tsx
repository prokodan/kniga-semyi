// /admin/ai — админка ИИ: расход, квоты, ошибки, переключатели провайдеров. Вход по ADMIN_PIN.
import type { Metadata } from "next";
import { CacheCoolingSection, ErrorsSection, QuotaSection, SpendSection } from "@/components/admin/AiReadouts";
import { ProvidersSection, RoutesSection } from "@/components/admin/AiControls";
import { btnCls, btnGhostCls, fmtTime, inputCls, Notice } from "@/components/admin/ui";
import { getAiMode } from "@/lib/env";
import { login, logout } from "./actions";
import { loadAdminData, type AdminData } from "./_lib/data";
import { isAdmin, isAdminConfigured } from "./_lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ИИ · админка · Книга семьи", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const MODE_HINT: Record<string, string> = {
  mock: "AI_MODE=mock — все шаги отвечает заглушка, маршруты ниже не используются.",
  auto: "AI_MODE=auto — роутер идёт по маршрутам ниже.",
  gemini: "AI_MODE=gemini — роутер берёт из маршрутов только Gemini.",
  openai: "AI_MODE=openai — роутер берёт из маршрутов только OpenAI.",
};

export default async function AdminAiPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const ok = one(sp.ok);
  const err = one(sp.err);
  const at = one(sp.at);

  if (!isAdminConfigured()) {
    return (
      <Shell>
        <Notice tone="info">Админка выключена: задайте ADMIN_PIN в Vercel → Environment Variables и сделайте redeploy.</Notice>
      </Shell>
    );
  }

  if (!(await isAdmin())) {
    return (
      <Shell>
        {err ? <Notice tone="err">{err}</Notice> : null}
        <form action={login} className="flex flex-col gap-3 rounded-card bg-paper-deep p-5 shadow-card">
          <label className="flex flex-col gap-1">
            <span className="text-ink-soft">PIN администратора</span>
            <input
              className={inputCls}
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              required
              autoFocus
            />
          </label>
          <button className={btnCls} type="submit">
            Войти
          </button>
        </form>
      </Shell>
    );
  }

  let data: AdminData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadAdminData();
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
    console.error("[admin/ai]", loadError);
  }
  const mode = getAiMode();

  return (
    <Shell
      right={
        <form action={logout}>
          <button className={btnGhostCls} type="submit">
            Выйти
          </button>
        </form>
      }
    >
      {ok ? <Notice tone="ok">{ok}</Notice> : null}
      {err ? <Notice tone="err">{err}</Notice> : null}
      <Notice tone="info">
        {MODE_HINT[mode] ?? mode}{" "}
        {data?.source === "memory" ? "База не настроена — показана память сервера (локальный режим)." : null}
        {data ? <> Обновлено {fmtTime(data.summary.now)} (Алматы).</> : null}
      </Notice>
      {loadError ? <Notice tone="err">Не удалось прочитать таблицы ai_*: {loadError}</Notice> : null}
      <nav className="flex gap-2 overflow-x-auto text-sm" aria-label="Разделы">
        {[
          ["#spend", "Расход"],
          ["#quotas", "Квоты"],
          ["#errors", "Ошибки"],
          ["#providers", "Провайдеры"],
          ["#routes", "Маршруты"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="flex min-h-12 shrink-0 items-center rounded-button border border-line bg-paper px-4">
            {label}
          </a>
        ))}
      </nav>
      {data ? (
        <>
          <SpendSection s={data.summary} />
          <QuotaSection s={data.summary} />
          <CacheCoolingSection s={data.summary} />
          <ErrorsSection s={data.summary} />
          <ProvidersSection providers={data.providers} />
          <RoutesSection routes={data.routes} openStep={at?.startsWith("step-") ? at.slice(5) : undefined} />
        </>
      ) : null}
    </Shell>
  );
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">Книга семьи · админка</p>
          <h1 className="font-serif text-2xl">ИИ: расход и провайдеры</h1>
        </div>
        {right}
      </header>
      {children}
    </main>
  );
}
