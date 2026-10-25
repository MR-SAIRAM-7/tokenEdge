import { Scale } from "lucide-react";
import { useMemo, useState } from "react";
import type { CompareResponse } from "../api/types";
import { strategyColor } from "../lib/colors";
import { isIntraday, money, num, pct } from "../lib/format";
import { COMPARE_KEYS } from "../lib/metrics";
import { useTheme } from "../state/theme";
import { DiagnosticsCard, RunHeader } from "./BacktestResults";
import { BootstrapHistogram, HBarChart } from "./charts/Bars";
import { MonthlyHeatmap } from "./charts/Grids";
import { TimeSeriesChart } from "./charts/TimeSeriesChart";
import { XYChart } from "./charts/XYChart";
import { MetricsTable, TradesTable } from "./MetricsViews";
import { Badge, Card, CardHeader, Segmented } from "./ui";

export function CompareResults({ run }: { run: CompareResponse }) {
  const { mode } = useTheme();
  const intraday = isIntraday(run.interval);
  const labels = Object.fromEntries(run.strategies.map((s) => [s.key, s.label]));
  const keys = run.strategies.map((s) => s.key);
  const color = (k: string) => strategyColor(k, mode);
  const [tradeKey, setTradeKey] = useState(keys[0]);
  const [monthKey, setMonthKey] = useState(keys[0]);

  const [equity, drawdown] = useMemo(() => {
    const build = (values: Record<string, (number | null)[]>) =>
      run.strategies.map((s) => ({ key: s.key, label: s.label, color: strategyColor(s.key, mode), values: values[s.key] }));
    return [build(run.series.equity), build(run.series.drawdown)];
  }, [run, mode]);
  const challengers = keys.filter((k) => k !== run.baseline && run.sharpe_diff[k]);
  const mlKeys = keys.filter((k) => run.diagnostics?.[k]);

  return (
    <div className="space-y-4">
      <RunHeader run={{ ...run, kind: "compare" }} />

      <Card className="border-accent/40">
        <div className="flex gap-3 p-4">
          <Scale className="mt-0.5 size-5 shrink-0 text-accent" />
          <div>
            <div className="text-sm font-semibold text-fg">Verdict</div>
            <p className="mt-1 text-sm leading-relaxed text-fg-2">{run.verdict}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Equity curves" subtitle="Same window, same costs, same starting capital. Signals execute at the next bar's open." />
        <div className="px-4 pb-4">
          <TimeSeriesChart
            timestamps={run.series.timestamp}
            series={equity}
            yFormat={(v) => money(v)}
            intraday={intraday}
            height={320}
            legendValue={(s) => pct(run.metrics[s.key]?.total_return, 1, true)}
            exportName={`compare_equity_${run.symbol}`}
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Drawdowns" />
          <div className="px-4 pb-4">
            <TimeSeriesChart
              timestamps={run.series.timestamp}
              series={drawdown}
              yFormat={(v) => pct(v, 0)}
              intraday={intraday}
              height={240}
              zeroLine
              legendValue={(s) => pct(run.metrics[s.key]?.max_drawdown, 1)}
              exportName={`compare_drawdown_${run.symbol}`}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Is the Sharpe ratio real?"
            subtitle="PSR = probability the true Sharpe is above 0. DSR also corrects for the number of configurations tried."
          />
          <div className="space-y-4 px-4 pb-4">
            <div>
              <div className="mb-1 text-xs font-medium text-fg-2">Probabilistic Sharpe Ratio</div>
              <HBarChart
                items={keys.map((k) => ({ label: labels[k], value: run.metrics[k]?.psr ?? null, color: color(k) }))}
                format={(v) => pct(v, 0)}
                domain={[0, 1]}
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-fg-2">Deflated Sharpe Ratio</div>
              <HBarChart
                items={keys.map((k) => ({
                  label: labels[k],
                  value: run.dsr[k]?.dsr ?? null,
                  color: color(k),
                  note: `${run.dsr[k]?.n_trials ?? 1} trial(s); SR₀ = ${num(run.dsr[k]?.sr0_annual, 2)}`,
                }))}
                format={(v) => pct(v, 0)}
                domain={[0, 1]}
              />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Metrics" subtitle="● marks the best value in each row." />
        <div className="px-4 pb-4">
          <MetricsTable columns={keys.map((k) => ({ key: k, label: labels[k], color: color(k), metrics: run.metrics[k] }))} rows={COMPARE_KEYS} />
        </div>
      </Card>

      {challengers.length > 0 && (
        <Card>
          <CardHeader
            title={`Bootstrap test vs ${labels[run.baseline]}`}
            subtitle="Paired stationary block bootstrap of the Sharpe difference. The shaded band is the 95% confidence interval; if it includes 0 the difference is not significant."
          />
          <div
            className={
              challengers.length === 1
                ? "grid max-w-2xl gap-4 px-4 pb-4"
                : challengers.length === 2
                  ? "grid gap-4 px-4 pb-4 md:grid-cols-2"
                  : "grid gap-4 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3"
            }
          >
            {challengers.map((k) => {
              const d = run.sharpe_diff[k]!;
              return (
                <div key={k} className="rounded-lg border border-line p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg">
                      <span className="h-[3px] w-3 rounded-full" style={{ background: color(k) }} />
                      {labels[k]} − {labels[run.baseline]}
                    </span>
                    <Badge tone={d.significant ? (d.estimate > 0 ? "ok" : "bad") : "neutral"}>{d.significant ? "significant" : "not significant"}</Badge>
                  </div>
                  <div className="tabular text-xs text-fg-2">
                    Δ Sharpe {num(d.estimate, 2, true)} · 95% CI [{num(d.ci_low, 2, true)}, {num(d.ci_high, 2, true)}] · p = {num(d.p_value, 3)}
                  </div>
                  <BootstrapHistogram diff={d} color={color(k)} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {run.sensitivity && (
        <Card>
          <CardHeader
            title="Cost sensitivity"
            subtitle="Each strategy re-run with a flat commission of N bps per side and no slippage. Break-even = cost at which total return reaches zero."
          />
          <div className="grid gap-4 px-4 pb-4 lg:grid-cols-[1fr_280px]">
            <XYChart
              series={keys.map((k) => ({
                key: k,
                label: labels[k],
                color: color(k),
                dots: true,
                points: run.sensitivity!.levels.map((lv, i) => ({ x: lv, y: run.sensitivity!.strategies[k]?.sharpe[i] ?? null })),
              }))}
              xLabel="Cost per side (bps)"
              xTicks={run.sensitivity.levels}
              xFormat={(v) => `${v}`}
              yFormat={(v) => num(v, 2)}
              refY={0}
              height={260}
            />
            <table className="self-start text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5 font-medium">Strategy</th>
                  <th className="py-1.5 text-right font-medium">Break-even</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {keys.map((k) => {
                  const be = run.sensitivity!.strategies[k]?.break_even_bps;
                  return (
                    <tr key={k} className="border-b border-line/60 last:border-0">
                      <td className="py-1.5 text-fg-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-[3px] w-3 rounded-full" style={{ background: color(k) }} />
                          {labels[k]}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-fg">
                        {be === null || be === undefined ? `> ${Math.max(...run.sensitivity!.levels)} bps` : be === 0 ? "loses at 0 bps" : `${num(be, 1)} bps`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {mlKeys.length > 0 && (
        <Card>
          <CardHeader title="Accuracy vs profitability" subtitle="Classification quality of each ML model on this window, next to its trading result." />
          <div className="space-y-6 px-4 pb-4">
            {mlKeys.map((k) => (
              <div key={k}>
                <div className="mb-2 text-sm font-medium text-fg">
                  {labels[k]} · Sharpe {num(run.metrics[k]?.sharpe, 2)}
                </div>
                <DiagnosticsCard report={run.diagnostics[k]!} title="Direction calls on this window" />
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Monthly returns"
            actions={<Segmented size="sm" value={monthKey} onChange={setMonthKey} options={keys.map((k) => ({ value: k, label: labels[k] }))} />}
          />
          <div className="px-4 pb-4">
            <MonthlyHeatmap data={run.monthly_returns[monthKey] ?? []} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Trades"
            actions={<Segmented size="sm" value={tradeKey} onChange={setTradeKey} options={keys.map((k) => ({ value: k, label: labels[k] }))} />}
          />
          <div className="px-4 pb-4">
            <TradesTable trades={run.trades[tradeKey] ?? []} filename={`trades_${run.symbol}_${tradeKey}.csv`} intraday={intraday} />
          </div>
        </Card>
      </div>
    </div>
  );
}
