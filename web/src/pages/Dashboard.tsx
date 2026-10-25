import { ArrowRight, BrainCircuit, Database, FlaskConical, GitCompareArrows, History, ShieldCheck, Timer, Wallet } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useHealth, useModels, useRuns, useSymbols } from "../api/queries";
import { Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "../components/ui";
import { dateTimeLocal, num, pct } from "../lib/format";
import { useMarket } from "../state/market";

const PILLARS = [
  { icon: Timer, title: "Next-bar execution", text: "A signal computed at the close of bar t fills at the open of bar t+1. No strategy ever trades on the bar that produced its signal." },
  { icon: ShieldCheck, title: "Purged, embargoed splits", text: "Train → validation → test in time order. Samples whose label horizon crosses a boundary are dropped, plus an embargo gap." },
  { icon: Wallet, title: "Realistic costs", text: "Commission presets for US, NSE and crypto markets plus fixed, range-based or square-root-impact slippage." },
  { icon: GitCompareArrows, title: "Honest statistics", text: "Sharpe, drawdown, Probabilistic and Deflated Sharpe, and a block-bootstrap test of the Sharpe difference." },
];

export default function Dashboard() {
  const market = useMarket();
  const navigate = useNavigate();
  const { data: health } = useHealth();
  const { data: symbols } = useSymbols();
  const { data: models } = useModels();
  const { data: runs, isLoading: runsLoading } = useRuns({ limit: 6 });
  const { data: lastCompare } = useRuns({ kind: "compare", limit: 1 });
  const latest = lastCompare?.items[0];

  const stats = [
    { icon: Database, label: "Datasets bundled", value: symbols ? `${symbols.items.filter((s) => s.snapshot).length} / ${symbols.items.length}` : "…", to: "/data" },
    { icon: BrainCircuit, label: "Trained models", value: models ? String(models.length) : "…", to: "/models" },
    { icon: History, label: "Saved runs", value: runs ? String(runs.total) : "…", to: "/runs" },
    { icon: ShieldCheck, label: "Data mode", value: health ? (health.offline ? "Offline" : "Online") : "…", to: "/data" },
  ];

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="grid gap-6 p-6 md:grid-cols-[1.4fr_1fr] md:p-8">
          <div>
            <Badge tone="accent">Major project · algorithmic trading research</Badge>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg md:text-3xl">After costs, on unseen data, does machine learning beat a simple rule?</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-2">
              TokenEdge backtests a moving-average crossover against XGBoost and LSTM price-direction models on equities and crypto. Every strategy uses the same engine,
              costs and window. The ML models are judged only on a held-out period they never saw.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" icon={<GitCompareArrows className="size-4" />} onClick={() => navigate("/compare?autorun=1")}>
                Compare strategies on {market.symbol}
              </Button>
              <Button icon={<FlaskConical className="size-4" />} onClick={() => navigate("/backtest")}>
                Open Backtest Lab
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 self-center">
            {stats.map((s) => (
              <Link key={s.label} to={s.to} className="rounded-xl border border-line bg-panel-2 p-3 transition-colors hover:border-muted/60">
                <s.icon className="size-4 text-muted" />
                <div className="mt-2 text-lg font-semibold text-fg">{s.value}</div>
                <div className="text-xs text-muted">{s.label}</div>
              </Link>
            ))}
          </div>
        </div>
      </Card>

      {models && models.length === 0 && (
        <Card className="border-warn/40">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm text-fg-2">
              <span className="font-medium text-fg">No ML models yet.</span> Train XGBoost and LSTM in Google Colab (free GPU), then drop the exported folder into{" "}
              <code className="rounded bg-panel-2 px-1">models/</code>. SMA and Buy &amp; Hold work right away.
            </div>
            <Button size="sm" onClick={() => navigate("/models")} icon={<ArrowRight className="size-3.5" />}>
              How to train
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="Latest comparison" subtitle={latest ? `${latest.symbol} · ${latest.interval} · ${dateTimeLocal(latest.created_at)}` : undefined} />
          <div className="px-4 pb-4">
            {latest ? (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="py-1.5 font-medium">Strategy</th>
                        <th className="py-1.5 text-right font-medium">Return</th>
                        <th className="py-1.5 text-right font-medium">Sharpe</th>
                        <th className="py-1.5 text-right font-medium">Max DD</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {Object.entries(latest.metrics).map(([k, m], i) => (
                        <tr key={k} className="border-b border-line/60 last:border-0">
                          <td className="py-1.5 text-fg-2">{latest.strategies[i] ?? k}</td>
                          <td className="py-1.5 text-right text-fg">{pct(m.total_return, 1, true)}</td>
                          <td className="py-1.5 text-right text-fg">{num(m.sharpe, 2)}</td>
                          <td className="py-1.5 text-right text-fg">{pct(m.max_drawdown, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Link to={`/runs/${latest.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Open full report <ArrowRight className="size-3.5" />
                </Link>
              </div>
            ) : (
              <EmptyState title="No comparison yet">Run one from the Compare page to see the verdict here.</EmptyState>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent runs" actions={<Link className="text-xs text-accent hover:underline" to="/runs">View all</Link>} />
          <div className="px-4 pb-4">
            {runsLoading ? (
              <Skeleton className="h-32" />
            ) : runs?.items.length ? (
              <ul className="divide-y divide-line/60">
                {runs.items.map((r) => {
                  const best = Math.max(...Object.values(r.metrics).map((m) => (m.sharpe as number | null) ?? -99));
                  return (
                    <li key={r.id}>
                      <Link to={`/runs/${r.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-accent">
                        <span className="min-w-0 truncate">
                          <Badge tone="neutral" className="mr-2">
                            {r.kind}
                          </Badge>
                          {r.name ?? r.strategies.join(" vs ")} · {r.symbol}
                        </span>
                        <span className="tabular shrink-0 text-xs text-muted">Sharpe {best > -99 ? num(best, 2) : "—"}</span>
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PILLARS.map((p) => (
          <Card key={p.title} className="p-4">
            <p.icon className="size-5 text-accent" />
            <div className="mt-2 text-sm font-semibold text-fg">{p.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{p.text}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
