import clsx from "clsx";
import {
  ArrowRight,
  BrainCircuit,
  Compass,
  Database,
  GitCompareArrows,
  History,
  ShieldCheck,
  Timer,
  Trophy,
  Wallet,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useFindings, useHealth, useMarketsOverview, useModels, useRuns } from "../api/queries";
import { StudyCard } from "../components/StudyRunner";
import { Sparkline } from "../components/Sparkline";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "../components/ui";
import { dateTimeLocal, num, pct, price } from "../lib/format";
import { useMarket } from "../state/market";
import { useUi } from "../state/ui";
import { Scoreboard, takeaways } from "./Findings";

const PILLARS = [
  { icon: Timer, title: "Next-bar execution", text: "A signal computed at the close of bar t fills at the open of bar t+1. No strategy trades on the bar that produced its signal." },
  { icon: ShieldCheck, title: "Purged, embargoed splits", text: "Train, validation and test in time order. Samples whose label horizon crosses a boundary are dropped, plus an embargo gap." },
  { icon: Wallet, title: "Realistic costs", text: "Commission presets for US, NSE and crypto markets plus fixed, range-based or square-root-impact slippage." },
  { icon: GitCompareArrows, title: "Honest statistics", text: "Probabilistic and Deflated Sharpe ratios and a block-bootstrap test of the Sharpe difference between strategies." },
];

export default function Dashboard() {
  const market = useMarket();
  const navigate = useNavigate();
  const { startTour } = useUi();
  const { data: health } = useHealth();
  const { data: overview, isLoading: ovLoading } = useMarketsOverview();
  const { data: models } = useModels();
  const { data: runs, isLoading: runsLoading } = useRuns({ limit: 6 });
  const { data: findings } = useFindings();
  const hasRuns = (runs?.total ?? 0) > 0;
  const xgb = models?.filter((m) => m.model_type === "xgboost").length ?? 0;
  const lstm = models?.filter((m) => m.model_type === "lstm").length ?? 0;
  // One row per market, so both model types show up (a plain slice of the list is all LSTMs).
  const modelMarkets = Object.values(
    (models ?? []).reduce<Record<string, NonNullable<typeof models>>>((acc, m) => {
      (acc[`${m.symbol} · ${m.interval}`] ??= []).push(m);
      return acc;
    }, {}),
  ).map((list) => [...list].sort((a, b) => a.model_type.localeCompare(b.model_type)).reverse());

  const stats = [
    { icon: Database, label: "Markets bundled", value: overview ? String(overview.length) : "…", to: "/data" },
    { icon: BrainCircuit, label: "Trained models", value: models ? String(models.length) : "…", sub: models?.length ? `${xgb} XGBoost · ${lstm} LSTM` : "train in Colab", to: "/models" },
    { icon: History, label: "Saved runs", value: runs ? String(runs.total) : "…", to: "/runs" },
    { icon: Trophy, label: "Markets compared", value: findings ? String(findings.length) : "…", to: "/findings" },
  ];

  return (
    <div className="space-y-6">
      <Card className="hero-bg overflow-hidden">
        <div className="grid grid-cols-1 gap-8 p-6 md:p-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">Major project</Badge>
              <Badge tone="neutral">Algorithmic trading research</Badge>
              {health?.offline && <Badge tone="warn">Offline mode</Badge>}
            </div>
            <h1 className="mt-4 text-3xl leading-tight font-semibold tracking-tight text-fg md:text-[2.4rem]">
              After costs, on unseen data, does machine learning beat a simple rule?
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-fg-2">
              TokenEdge backtests a moving-average crossover against XGBoost and LSTM price-direction models on US and Indian equities and crypto. Every strategy uses the same engine,
              costs and window, and the ML models are judged only on a held-out period they never saw.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button variant="primary" icon={<Compass className="size-4" />} onClick={startTour}>
                Start guided tour
              </Button>
              <Button icon={<Trophy className="size-4" />} onClick={() => navigate("/findings")}>
                View findings
              </Button>
              <Button icon={<GitCompareArrows className="size-4" />} onClick={() => navigate("/compare?autorun=1")}>
                Compare on {market.symbol}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 self-center">
            {stats.map((s) => (
              <Link key={s.label} to={s.to} className="group rounded-xl border border-line bg-panel/70 p-4 backdrop-blur transition-colors hover:border-accent/50">
                <s.icon className="size-4 text-accent" />
                <div className="mt-3 text-2xl font-semibold tracking-tight text-fg">{s.value}</div>
                <div className="text-xs text-muted">{s.label}</div>
                {s.sub && <div className="mt-0.5 text-[11px] text-muted">{s.sub}</div>}
              </Link>
            ))}
          </div>
        </div>
      </Card>

      {!runsLoading && !hasRuns && (
        <Card className="border-accent/40">
          <StudyCard />
        </Card>
      )}

      {findings && findings.length > 0 && (
        <Card>
          <CardHeader
            title="Results at a glance"
            subtitle="Sharpe ratio of each strategy on its held-out window. Full details on the Findings page."
            actions={
              <Link to="/findings" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                All findings <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <div className="grid grid-cols-1 gap-6 px-4 pb-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Scoreboard items={findings} compact />
            <ul className="space-y-2.5 self-start rounded-xl bg-panel-2 p-4">
              {takeaways(findings)
                .slice(0, 3)
                .map((t) => (
                  <li key={t} className="flex gap-2.5 text-sm leading-relaxed text-fg-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                    {t}
                  </li>
                ))}
            </ul>
          </div>
        </Card>
      )}

      <div>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-base font-semibold text-fg">Markets</h2>
            <p className="text-xs text-muted">Bundled datasets, last 90 days. Click a market to explore it.</p>
          </div>
        </div>
        {ovLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {overview?.map((o) => {
              const up30 = (o.change_30d ?? 0) >= 0;
              const active = o.symbol === market.symbol && o.interval === market.interval;
              return (
                <button
                  key={`${o.source}${o.symbol}`}
                  onClick={() => {
                    market.setMarket({ symbol: o.symbol, source: o.source, interval: o.interval });
                    navigate("/data");
                  }}
                  className={clsx(
                    "group rounded-xl border bg-panel p-4 text-left shadow-card transition-colors",
                    active ? "border-accent/60" : "border-line hover:border-muted/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-fg">{o.symbol}</span>
                        <span className="text-[11px] text-muted">{o.interval}</span>
                      </div>
                      <div className="truncate text-xs text-muted">{o.name}</div>
                    </div>
                    <Sparkline values={o.sparkline} width={110} height={34} color={up30 ? "var(--pos)" : "var(--neg)"} />
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div className="tabular text-lg font-semibold text-fg">{price(o.last_close)}</div>
                    <div className="flex gap-3 text-xs">
                      <span className="text-muted">
                        1D <span className={clsx("tabular font-medium", (o.change_1d ?? 0) >= 0 ? "text-pos" : "text-neg")}>{pct(o.change_1d, 1, true)}</span>
                      </span>
                      <span className="text-muted">
                        1Y <span className={clsx("tabular font-medium", (o.change_1y ?? 0) >= 0 ? "text-pos" : "text-neg")}>{pct(o.change_1y, 0, true)}</span>
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Recent runs" actions={<Link className="text-xs font-medium text-accent hover:underline" to="/runs">View all</Link>} />
          <div className="px-4 pb-4">
            {runsLoading ? (
              <Skeleton className="h-40" />
            ) : runs?.items.length ? (
              <ul className="divide-y divide-line/60">
                {runs.items.map((r) => {
                  const sharpes = Object.values(r.metrics).map((m) => (m.sharpe as number | null) ?? null).filter((x): x is number => x !== null);
                  return (
                    <li key={r.id}>
                      <Link to={`/runs/${r.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-accent">
                        <span
                          className={clsx(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg",
                            r.kind === "compare" ? "bg-accent-soft text-accent" : "bg-panel-2 text-fg-2",
                          )}
                        >
                          {r.kind === "compare" ? <GitCompareArrows className="size-4" /> : <History className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-fg">{r.name ?? r.strategies.join(" vs ")}</span>
                          <span className="block text-xs text-muted">
                            {r.symbol} · {r.interval} · {dateTimeLocal(r.created_at)}
                          </span>
                        </span>
                        {r.in_sample && <Badge tone="bad">in-sample</Badge>}
                        <span className="tabular shrink-0 text-xs text-muted">Sharpe {sharpes.length ? num(Math.max(...sharpes), 2) : "—"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No runs yet">Backtests and comparisons are saved automatically.</EmptyState>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Models" actions={<Link className="text-xs font-medium text-accent hover:underline" to="/models">Details</Link>} />
          <div className="px-4 pb-4">
            {models?.length ? (
              <ul className="divide-y divide-line/60">
                {modelMarkets.slice(0, 8).map((list) => (
                  <li key={`${list[0].symbol}${list[0].interval}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg">
                        {list[0].symbol} <span className="text-[11px] font-normal text-muted">{list[0].interval}</span>
                      </span>
                      <span className="text-[11px] text-muted">held-out from {list[0].splits?.test?.[0]}</span>
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      {list.map((m) => (
                        <Link
                          key={m.model_id}
                          to={`/models/${encodeURIComponent(m.model_id)}`}
                          title={`${m.model_id}: validation AUC ${num(m.val_metrics.roc_auc, 3)}`}
                          className="rounded-lg border border-line px-2 py-1 text-[11px] text-fg-2 hover:border-accent/60 hover:text-fg"
                        >
                          <span className="font-medium">{m.model_type === "xgboost" ? "XGBoost" : "LSTM"}</span>{" "}
                          <span className="tabular text-muted">AUC {num(m.val_metrics.roc_auc, 2)}</span>
                        </Link>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<BrainCircuit className="size-7" />} title="No trained models yet">
                Train them in Google Colab; the SMA baseline works without any model.
              </EmptyState>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PILLARS.map((p) => (
          <Card key={p.title} className="p-5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <p.icon className="size-4.5" />
            </div>
            <div className="mt-3 text-sm font-semibold text-fg">{p.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{p.text}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
