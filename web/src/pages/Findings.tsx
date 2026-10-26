import clsx from "clsx";
import { ArrowRight, Download, Lightbulb, RefreshCw, Trophy } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFindings } from "../api/queries";
import type { Finding } from "../api/types";
import { Legend } from "../components/charts/TimeSeriesChart";
import { StudyCard, StudyProgress, useStudy } from "../components/StudyRunner";
import { Badge, Button, Card, CardHeader, PageHeader, Skeleton, StatTile } from "../components/ui";
import { CHROME, divergingColor, strategyColor, textOn } from "../lib/colors";
import { downloadCsv } from "../lib/download";
import { date, num, pct } from "../lib/format";
import { useTheme } from "../state/theme";

export const STRATEGY_ORDER = ["buy_hold", "sma_crossover", "xgboost", "lstm"] as const;
export const STRATEGY_NAMES: Record<string, string> = { buy_hold: "Buy & Hold", sma_crossover: "SMA (tuned)", xgboost: "XGBoost", lstm: "LSTM", sma_ml_filter: "SMA + ML filter" };

const market = (f: Finding) => `${f.symbol} · ${f.interval}`;

export function takeaways(items: Finding[]): string[] {
  if (!items.length) return [];
  const out: string[] = [];
  const wins: Record<string, number> = {};
  for (const f of items) wins[f.ranking[0]] = (wins[f.ranking[0]] ?? 0) + 1;
  const winText = STRATEGY_ORDER.filter((k) => wins[k]).map((k) => `${STRATEGY_NAMES[k]} in ${wins[k]}`);
  out.push(`Across ${items.length} market${items.length > 1 ? "s" : ""}, the highest Sharpe ratio came from ${winText.join(", ")}.`);

  for (const model of ["xgboost", "lstm"] as const) {
    const withModel = items.filter((f) => f.metrics[model] && f.metrics.sma_crossover);
    if (!withModel.length) continue;
    const beat = withModel.filter((f) => (f.metrics[model].sharpe ?? -99) > (f.metrics.sma_crossover.sharpe ?? -99)).length;
    const sig = withModel.filter((f) => f.sharpe_diff[model]?.significant && (f.sharpe_diff[model]?.estimate ?? 0) > 0).length;
    out.push(
      `${STRATEGY_NAMES[model]} beat the SMA baseline's Sharpe in ${beat} of ${withModel.length} market${withModel.length > 1 ? "s" : ""}; ` +
        (sig ? `${sig} of those improvement${sig > 1 ? "s were" : " was"} statistically significant (95% bootstrap interval above zero).` : "none of the differences was statistically significant at 95%."),
    );
  }

  const anySig = items.some((f) => Object.entries(f.sharpe_diff).some(([k, d]) => (k === "xgboost" || k === "lstm") && d?.significant && d.estimate > 0));
  if (items.some((f) => f.metrics.xgboost || f.metrics.lstm)) {
    out.push(
      anySig
        ? "Where ML wins significantly, check the Deflated Sharpe Ratio: it discounts the result for every configuration that was tried."
        : "After realistic costs and on unseen data, the evidence that ML adds value over a simple rule is weak on this sample: an honest negative result.",
    );
  }

  const avgDd = STRATEGY_ORDER.map((k) => {
    const v = items.map((f) => f.metrics[k]?.max_drawdown).filter((x): x is number => x != null);
    return { k, v: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
  }).filter((x) => x.v !== null) as { k: string; v: number }[];
  if (avgDd.length > 1) {
    const best = avgDd.reduce((a, b) => (b.v > a.v ? b : a));
    out.push(`Smallest average max drawdown: ${STRATEGY_NAMES[best.k]} (${pct(best.v, 1)}). Active strategies often trade some return for lower drawdowns.`);
  }
  return out;
}

export function Scoreboard({ items, compact = false }: { items: Finding[]; compact?: boolean }) {
  const { mode } = useTheme();
  const cols = STRATEGY_ORDER.filter((k) => items.some((f) => f.metrics[k]));
  const maxAbs = Math.max(0.25, ...items.flatMap((f) => cols.map((k) => Math.abs(f.metrics[k]?.sharpe ?? 0))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-[3px] text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="px-2 py-1.5 text-left font-medium">Market</th>
            {cols.map((k) => (
              <th key={k} className="px-2 py-1.5 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[3px] w-3 rounded-full" style={{ background: strategyColor(k, mode) }} />
                  {STRATEGY_NAMES[k]}
                </span>
              </th>
            ))}
            {!compact && <th className="px-2 py-1.5 text-left font-medium">Held-out window</th>}
          </tr>
        </thead>
        <tbody className="tabular">
          {items.map((f) => {
            const best = f.ranking[0];
            return (
              <tr key={f.run_id}>
                <td className="rounded-lg px-2 py-2 font-medium whitespace-nowrap text-fg">
                  <Link to={`/runs/${f.run_id}`} className="hover:text-accent">
                    {market(f)}
                  </Link>
                </td>
                {cols.map((k) => {
                  const m = f.metrics[k];
                  if (!m) return <td key={k} className="rounded-lg bg-panel-2 px-2 py-2 text-center text-xs text-muted">—</td>;
                  const bg = divergingColor(m.sharpe, maxAbs, mode);
                  const d = f.sharpe_diff[k];
                  const sigUp = d?.significant && d.estimate > 0 && k !== "buy_hold";
                  const sigDown = d?.significant && d.estimate < 0 && k !== "buy_hold";
                  return (
                    <td
                      key={k}
                      className={clsx("relative rounded-lg px-2 py-2 text-center", k === best && "ring-2 ring-fg/70 ring-inset")}
                      style={{ background: bg, color: textOn(bg) }}
                      title={`${STRATEGY_NAMES[k]} on ${market(f)}\nSharpe ${num(m.sharpe)} · return ${pct(m.total_return, 1, true)} · max DD ${pct(m.max_drawdown, 1)}\nPSR ${pct(m.psr, 0)} · DSR ${pct(f.dsr[k]?.dsr, 0)}${d ? `\nvs SMA: ${num(d.estimate, 2, true)} [${num(d.ci_low, 2, true)}, ${num(d.ci_high, 2, true)}]` : ""}`}
                    >
                      <span className="font-semibold">{num(m.sharpe, 2)}</span>
                      {!compact && <span className="ml-1.5 text-[11px] opacity-80">{pct(m.total_return, 0, true)}</span>}
                      {sigUp && <span className="ml-1 text-[11px]" aria-label="significantly better than SMA">▲</span>}
                      {sigDown && <span className="ml-1 text-[11px]" aria-label="significantly worse than SMA">▼</span>}
                    </td>
                  );
                })}
                {!compact && (
                  <td className="px-2 py-2 text-xs whitespace-nowrap text-muted">
                    {date(f.window.start)} → {date(f.window.end)}
                    {f.in_sample && (
                      <Badge tone="bad" className="ml-2">
                        in-sample
                      </Badge>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>Cell = annualized Sharpe ratio{!compact && " and total return"}. Blue positive, red negative.</span>
        <span>Outlined = best in the market.</span>
        <span>▲ / ▼ = significantly better / worse than SMA (95% bootstrap).</span>
      </div>
    </div>
  );
}

function GroupedBars({ items, metric, format }: { items: Finding[]; metric: "sharpe" | "max_drawdown"; format: (v: number) => string }) {
  const { mode } = useTheme();
  const c = CHROME[mode];
  const cols = STRATEGY_ORDER.filter((k) => items.some((f) => f.metrics[k]));
  const data = items.map((f) => ({ market: f.symbol, ...Object.fromEntries(cols.map((k) => [k, f.metrics[k]?.[metric] ?? null])) }));
  return (
    <div>
      <div className="mb-2">
        <Legend items={cols.map((k) => ({ key: k, label: STRATEGY_NAMES[k], color: strategyColor(k, mode) }))} />
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="market" stroke={c.axis} tickLine={false} />
            <YAxis tickFormatter={(v: number) => format(v)} stroke={c.axis} tickLine={false} axisLine={false} width={52} />
            <ReferenceLine y={0} stroke={c.axis} />
            <Tooltip
              cursor={{ fill: c.grid, opacity: 0.5 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
                    <div className="mb-1 font-medium text-fg">{label}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                        <span className="inline-flex items-center gap-1.5 text-fg-2">
                          <span className="size-2 rounded-full" style={{ background: strategyColor(String(p.dataKey), mode) }} />
                          {STRATEGY_NAMES[String(p.dataKey)]}
                        </span>
                        <span className="tabular text-fg">{p.value == null ? "—" : format(p.value as number)}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {cols.map((k) => (
              <Bar key={k} dataKey={k} fill={strategyColor(k, mode)} maxBarSize={22} radius={metric === "sharpe" ? [4, 4, 0, 0] : [0, 0, 4, 4]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Findings() {
  const { data: items, isLoading } = useFindings();
  const { running, status, start } = useStudy();
  const notes = useMemo(() => takeaways(items ?? []), [items]);

  const stats = useMemo(() => {
    const list = items ?? [];
    const wins: Record<string, number> = {};
    list.forEach((f) => (wins[f.ranking[0]] = (wins[f.ranking[0]] ?? 0) + 1));
    const top = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
    let mlCmp = 0;
    let mlBeat = 0;
    let mlSig = 0;
    for (const f of list) {
      for (const m of ["xgboost", "lstm"]) {
        if (!f.metrics[m] || !f.metrics.sma_crossover) continue;
        mlCmp += 1;
        if ((f.metrics[m].sharpe ?? -99) > (f.metrics.sma_crossover.sharpe ?? -99)) mlBeat += 1;
        if (f.sharpe_diff[m]?.significant && (f.sharpe_diff[m]?.estimate ?? 0) > 0) mlSig += 1;
      }
    }
    return { markets: list.length, top, mlCmp, mlBeat, mlSig, adHoc: list.filter((f) => !f.study).length };
  }, [items]);

  const exportCsv = () => {
    const rows = (items ?? []).flatMap((f) =>
      Object.entries(f.metrics).map(([k, m]) => ({
        market: market(f),
        strategy: STRATEGY_NAMES[k] ?? k,
        window_start: f.window.start.slice(0, 10),
        window_end: f.window.end.slice(0, 10),
        total_return: m.total_return,
        cagr: m.cagr,
        sharpe: m.sharpe,
        sortino: m.sortino,
        max_drawdown: m.max_drawdown,
        psr: m.psr,
        dsr: f.dsr[k]?.dsr ?? null,
        sharpe_diff_vs_sma: f.sharpe_diff[k]?.estimate ?? null,
        ci_low: f.sharpe_diff[k]?.ci_low ?? null,
        ci_high: f.sharpe_diff[k]?.ci_high ?? null,
        trades: m.trades,
      })),
    );
    downloadCsv(rows, "tokenedge_findings.csv");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Trophy className="size-5" />}
        eyebrow="Results"
        title="Research findings"
        subtitle="The research study's comparison for every market, on each model's held-out window with realistic costs. This page answers the project's research question."
        actions={
          items?.length ? (
            <>
              <Button icon={<RefreshCw className="size-4" />} loading={running} onClick={() => start(true)} title="Re-run every scenario of the research study">
                Re-run study
              </Button>
              <Button icon={<Download className="size-4" />} onClick={exportCsv}>
                CSV
              </Button>
            </>
          ) : undefined
        }
      />
      {running && items?.length ? (
        <Card className="p-4">
          <StudyProgress status={status} />
        </Card>
      ) : null}

      {isLoading && <Skeleton className="h-80" />}
      {items && items.length === 0 && (
        <Card>
          <StudyCard />
        </Card>
      )}

      {items && items.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Markets evaluated" value={stats.markets} sub={stats.adHoc ? `${stats.adHoc} from an ad-hoc comparison` : "research study comparisons"} />
            <StatTile label="Most frequent winner" value={stats.top ? STRATEGY_NAMES[stats.top[0]] ?? stats.top[0] : "—"} sub={stats.top ? `best Sharpe in ${stats.top[1]} of ${stats.markets}` : undefined} />
            <StatTile label="ML beat SMA (Sharpe)" value={stats.mlCmp ? `${stats.mlBeat} / ${stats.mlCmp}` : "—"} sub="model-vs-baseline comparisons" />
            <StatTile label="Significant ML edges" value={stats.mlCmp ? stats.mlSig : "—"} sub="95% bootstrap interval above 0" />
          </div>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Lightbulb className="size-4 text-warn" /> Key takeaways</span>} subtitle="Generated from the stored results; they update when you re-run the comparisons." />
            <ul className="space-y-2 px-4 pb-5">
              {notes.map((n) => (
                <li key={n} className="flex gap-2.5 text-sm leading-relaxed text-fg-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                  {n}
                </li>
              ))}
            </ul>
          </Card>

          <Card data-tour="scoreboard">
            <CardHeader title="Scoreboard" subtitle="Hover a cell for return, drawdown, PSR, DSR and the bootstrap interval. Click a market to open its full report." />
            <div className="px-4 pb-4">
              <Scoreboard items={items} />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Sharpe ratio by market" subtitle="Risk-adjusted return after costs. Higher is better." />
              <div className="px-4 pb-4">
                <GroupedBars items={items} metric="sharpe" format={(v) => num(v, 1)} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Maximum drawdown by market" subtitle="Worst peak-to-trough loss. Closer to zero is better." />
              <div className="px-4 pb-4">
                <GroupedBars items={items} metric="max_drawdown" format={(v) => pct(v, 0)} />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((f) => (
              <Card key={f.run_id} className="flex flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-fg">{market(f)}</div>
                  <Badge tone="neutral">{f.execution.preset ?? "custom costs"}</Badge>
                </div>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-2">{f.verdict}</p>
                <Link to={`/runs/${f.run_id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Full report <ArrowRight className="size-3.5" />
                </Link>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
