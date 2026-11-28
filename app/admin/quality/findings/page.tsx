// #354 (docs/v2/QUALITY_LOOP.md §3.3): вкладка «Находки» — разбор отзывов проверяющих по компонентам (промпт перевода,
// глоссарий, правило проверки, словарь имён, модель) и парам: сколько нашли, сколько раз, примеры «было → правка
// носителя», кнопка «Предложить правку» (Actions → quality-propose → PR quality/<пара>-<дата>). Разбор — pg_cron раз в
// час, сразу после «Готово» у проверяющего и кнопкой «Разобрать сейчас». Только вымышленные тексты банка / eval / демо.
import Link from "next/link";
import { Badge, Card, Notice, Section, btnCls, btnGhostCls, fmtTime, fmtUsd } from "@/components/admin/ui";
import { digestDailyUsd } from "@/lib/quality/digest";
import {
  AUTO_PROPOSE_MIN,
  COMPONENT_RU,
  COMPONENT_WHERE,
  PROPOSAL_RU,
  SEVERITY_RU,
  groupByComponent,
  type FindingSeverity,
  type QualityDigest,
  type QualityFinding,
  type QualityProposal,
} from "@/lib/quality/findings";
import { PAIR_RU, QUALITY_PAIRS, type QualityPair } from "@/lib/quality/types";
import { digestAction, proposeAction, setFindingAction } from "./actions";
import { QUALITY_PROPOSE_URL, canDispatch, digestRepo } from "./_lib/store";

export const dynamic = "force-dynamic";
/** «Разобрать сейчас» ждёт модель — до лимита функции */
export const maxDuration = 60;

type Search = Promise<{ pair?: string; all?: string; msg?: string; tone?: string }>;

const SEV_TONE: Record<FindingSeverity, "ok" | "near" | "over"> = { minor: "ok", major: "near", critical: "over" };
const DIGEST_RU: Record<QualityDigest["status"], string> = {
  running: "идёт",
  ok: "готово",
  partial: "частично",
  budget: "лимит $",
  idle: "нечего разбирать",
  error: "ошибка",
};
const chip = "inline-flex items-center rounded-button border border-line bg-paper px-2 py-0.5 text-xs text-ink-soft";

function Evidence({ f }: { f: QualityFinding }) {
  const ev = f.evidence.filter((e) => e.before || e.after).slice(0, 2);
  if (!ev.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {ev.map((e, i) => (
        <li key={i} className="rounded-card border border-line bg-paper-deep px-3 py-2" data-testid="finding-example">
          {e.kind === "term" ? <span className="text-muted">слово: </span> : e.paragraph !== undefined ? <span className="text-muted">абз. {e.paragraph + 1}: </span> : null}
          <span className="text-danger line-through">{e.before.slice(0, 220)}</span> <span aria-hidden>→</span>{" "}
          <b className="text-success">{e.after.slice(0, 220)}</b>
          {e.note ? <span className="text-muted"> · {e.note.slice(0, 120)}</span> : null}
          <span className="text-muted"> · {e.reviewer}</span>
        </li>
      ))}
    </ul>
  );
}

function fixLine(f: QualityFinding): string {
  const x = f.fix;
  if (x.rule) return x.rule;
  if (x.wrong || x.right) return `${x.src ? `«${x.src}»: ` : ""}${x.wrong ? `не «${x.wrong}», ` : ""}а «${x.right}»`;
  return "";
}

function FindingRow({ f, pair, prs }: { f: QualityFinding; pair: QualityPair; prs: Map<string, QualityProposal> }) {
  const pr = f.proposal_id ? prs.get(f.proposal_id) : undefined;
  const fix = fixLine(f);
  return (
    <li className="flex flex-col gap-2 border-t border-line pt-3" data-finding={f.component} data-status={f.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEV_TONE[f.severity]}>{SEVERITY_RU[f.severity]}</Badge>
        <span className={chip} title="в скольких текстах нашли">
          ×{f.count}
        </span>
        {f.status === "proposed" ? (
          <span className={chip}>
            в предложении{pr?.pr_url ? (
              <>
                {" "}
                <a href={pr.pr_url} className="ml-1 underline">
                  PR #{pr.pr_number}
                </a>
              </>
            ) : null}
          </span>
        ) : f.status === "dismissed" ? (
          <span className={chip}>скрыта</span>
        ) : null}
        <span className="text-xs text-muted">{fmtTime(f.updated_at)}</span>
      </div>
      <p className="text-base" data-testid="finding-summary">
        {f.summary}
      </p>
      {fix ? <p className="text-sm text-ink-soft">Правка: {fix}</p> : null}
      <Evidence f={f} />
      {f.status !== "proposed" ? (
        <form action={setFindingAction}>
          <input type="hidden" name="pair" value={pair} />
          <input type="hidden" name="id" value={f.id} />
          <input type="hidden" name="status" value={f.status === "dismissed" ? "new" : "dismissed"} />
          <button type="submit" className={btnGhostCls}>
            {f.status === "dismissed" ? "Вернуть" : "Скрыть"}
          </button>
        </form>
      ) : null}
    </li>
  );
}

export default async function QualityFindingsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const pair: QualityPair = (QUALITY_PAIRS as readonly string[]).includes(sp.pair ?? "") ? (sp.pair as QualityPair) : "ru-kk";
  const showAll = sp.all === "1";
  const { repo, memory } = digestRepo();
  let findings: QualityFinding[] = [];
  let digests: QualityDigest[] = [];
  let proposals: QualityProposal[] = [];
  let spent = 0;
  let failed = false;
  try {
    [findings, digests, proposals, spent] = await Promise.all([
      repo.findings({ pair }),
      repo.digests(5),
      repo.proposals({ pair, limit: 10 }),
      repo.spentSince(new Date(Date.now() - 24 * 3600_000)),
    ]);
  } catch (e) {
    failed = true;
    console.error("[admin/quality/findings]", e instanceof Error ? e.message : e);
  }
  const daily = digestDailyUsd();
  const groups = groupByComponent(findings);
  const prs = new Map(proposals.map((p) => [p.id, p]));
  const count = (s: QualityFinding["status"]) => findings.filter((f) => f.status === s).length;
  const last = digests[0];
  const dispatchOk = canDispatch();
  const href = (q: { pair?: string; all?: boolean }) => {
    const u = new URLSearchParams({ pair: q.pair ?? pair, ...((q.all ?? showAll) ? { all: "1" } : {}) });
    return `/admin/quality/findings?${u}`;
  };

  return (
    <div className="flex flex-col gap-4" data-testid="quality-findings">
      {sp.msg ? <Notice tone={sp.tone === "err" ? "err" : "ok"}>{sp.msg}</Notice> : null}
      {memory ? <Notice tone="info">База не настроена — разбор живёт в памяти сервера (локальный режим), отзывов в нём нет.</Notice> : null}
      {failed ? <Notice tone="err">Не удалось прочитать находки. Если миграция #354 ещё не прошла — запустите workflow migrate.</Notice> : null}

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Языковая пара">
        {QUALITY_PAIRS.map((p) => (
          <Link
            key={p}
            href={href({ pair: p })}
            aria-current={p === pair ? "page" : undefined}
            className={`flex min-h-12 items-center rounded-button border px-4 ${p === pair ? "border-jade bg-paper font-medium text-jade" : "border-line bg-paper"}`}
          >
            {PAIR_RU[p]}
          </Link>
        ))}
      </nav>

      <Section
        title={`Находки ${PAIR_RU[pair]}`}
        hint={
          <>
            Разбор отзывов проверяющих (шаг ИИ quality_analyze — самая сильная модель): раз в час и сразу после «Готово» у
            проверяющего. Одинаковые ошибки сливаются. При {AUTO_PROPOSE_MIN} и больше новых находках одного компонента
            предложение правки запускается само.
          </>
        }
      >
        <p className="text-sm" data-testid="findings-summary">
          Новых <b>{count("new")}</b> · в предложениях <b>{count("proposed")}</b> · скрытых <b>{count("dismissed")}</b> · на разбор за
          сутки <b>{fmtUsd(spent)}</b> из {fmtUsd(daily)}
          {last ? (
            <span className="text-muted">
              {" "}
              · последний разбор {fmtTime(last.started_at)} — {DIGEST_RU[last.status]}
              {last.items_analyzed ? `, текстов ${last.items_analyzed}` : ""}
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form action={digestAction}>
            <input type="hidden" name="pair" value={pair} />
            <button type="submit" className={btnCls} data-testid="digest-now">
              Разобрать сейчас
            </button>
          </form>
          <Link href={href({ all: !showAll })} className="flex min-h-12 items-center text-sm underline">
            {showAll ? "Скрыть скрытые и предложенные" : "Показать все, со скрытыми"}
          </Link>
          <a className="flex min-h-12 items-center text-sm underline" href={QUALITY_PROPOSE_URL}>
            Actions → quality-propose
          </a>
        </div>
        {!dispatchOk ? (
          <Notice tone="info">
            На этом окружении нет GITHUB_TOKEN: «Предложить правку» подскажет запустить Actions → quality-propose вручную (#362).
          </Notice>
        ) : null}
      </Section>

      {groups.map((g) => {
        const shown = g.findings.filter((f) => showAll || f.status === "new");
        return (
          <Card key={g.component}>
            <div className="flex flex-col gap-3" data-component={g.component}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-serif text-lg">{COMPONENT_RU[g.component]}</h3>
                  <p className="text-sm text-ink-soft" data-testid="component-counters">
                    находок <b className="text-ink">{g.findings.length}</b> · новых <b className="text-ink">{g.open}</b> · нашли раз{" "}
                    <b className="text-ink">{g.hits}</b>
                    {g.worst ? (
                      <>
                        {" "}
                        · <Badge tone={SEV_TONE[g.worst]}>{SEVERITY_RU[g.worst]}</Badge>
                      </>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">Куда правка: {COMPONENT_WHERE[g.component]}</p>
                </div>
                <form action={proposeAction}>
                  <input type="hidden" name="pair" value={pair} />
                  <input type="hidden" name="component" value={g.component} />
                  <button type="submit" className={btnCls} disabled={!g.open} data-testid={`propose-${g.component}`}>
                    {g.component === "model_route" ? "Завести issue" : "Предложить правку"}
                  </button>
                </form>
              </div>
              {shown.length ? (
                <ul className="flex flex-col gap-3">
                  {shown.slice(0, 30).map((f) => (
                    <FindingRow key={f.id} f={f} pair={pair} prs={prs} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{g.findings.length ? "Новых нет — остальные в предложениях или скрыты." : "Пока ничего не нашли."}</p>
              )}
            </div>
          </Card>
        );
      })}

      <Section title="Предложения правок" hint="PR quality/<пара>-<дата> — только промпт перевода, глоссарий, правила проверки, золотой набор. До / после и «Одобрить» — вкладка «Изменения».">
        {proposals.length ? (
          <ul className="flex flex-col gap-2 text-sm" data-testid="proposals">
            {proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                <span className={chip}>{PROPOSAL_RU[p.status]}</span>
                {p.pr_url ? (
                  <a href={p.pr_url} className="underline">
                    PR #{p.pr_number} · {p.branch}
                  </a>
                ) : (
                  <span>{p.branch ?? "ветка ещё не создана"}</span>
                )}
                <span className="text-muted">
                  находок {p.findings.length} · {p.components.join(", ")} · {fmtTime(p.created_at)}
                </span>
                {p.error ? <span className="text-danger">{p.error.slice(0, 160)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Предложений по этой паре ещё не было.</p>
        )}
      </Section>
    </div>
  );
}
