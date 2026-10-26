import { Download, FileJson } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { BacktestResponse, ClassificationReport } from "../api/types";
import { CHROME, strategyColor } from "../lib/colors";
import { downloadCanvas } from "../lib/download";
import { date, isIntraday, money, num, pct } from "../lib/format";
import { COMPARE_KEYS } from "../lib/metrics";
import { useTheme } from "../state/theme";
import { ConfusionMatrix, MonthlyHeatmap } from "./charts/Grids";
import { PriceChart, type PriceChartHandle } from "./charts/PriceChart";
import { TimeSeriesChart } from "./charts/TimeSeriesChart";
import { KpiTiles, MetricsTable, TradesTable } from "./MetricsViews";
import { Alert, Badge, Button, Card, CardHeader, SampleBadge, Tabs } from "./ui";

type Tab = "performance" | "trades_chart" | "monthly" | "trades" | "metrics" | "ml";

export function RunHeader({ run }: { run: BacktestResponse | { symbol: string; interval: string; window: { start: string; end: string; name: string }; in_sample: boolean; held_out_start: string | null; warnings: string[]; execution: BacktestResponse["execution"]; data_hash: string; run_id?: string; kind: string } }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <SampleBadge inSample={run.in_sample} heldOutStart={run.held_out_start} />
        <Badge tone="neutral">
          {run.symbol} · {run.interval}
        </Badge>
        <Badge tone="neutral" title={`Window preset: ${run.window.name}`}>
          {date(run.window.start)} → {date(run.window.end)}
        </Badge>
        <Badge tone="neutral" title="Execution settings">
          {run.execution.preset ?? "custom costs"} · buy {run.execution.commission.buy_bps} / sell {run.execution.commission.sell_bps} bps · slip{" "}
          {run.execution.slippage.model === "fixed" ? `${run.execution.slippage.bps} bps` : run.execution.slippage.model} · {run.execution.mode.replace("_", "/")}
        </Badge>
        <span className="font-mono text-[11px] text-muted" title="Data hash: identifies the exact bars used">
          {run.data_hash.slice(0, 19)}…
        </span>
        {run.run_id && (
          <span className="ml-auto flex gap-1">
            <a href={api.url(`/runs/${run.run_id}/export`, { format: "csv" })}>
              <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />}>
                CSV
              </Button>
            </a>
            <a href={api.url(`/runs/${run.run_id}/export`, { format: "json" })}>
              <Button size="sm" variant="ghost" icon={<FileJson className="size-3.5" />}>
                JSON
              </Button>
            </a>
          </span>
        )}
      </div>
      {run.in_sample && (
        <Alert tone="warn" title="In-sample window">
          This window overlaps data the model was trained or validated on, so results are optimistic. Use the model's test window for honest numbers.
        </Alert>
      )}
      {run.warnings.map((w) => (
        <Alert key={w} tone="warn">
          {w}
        </Alert>
      ))}
    </div>
  );
}

export function DiagnosticsCard({ report, title = "Classification on this window" }: { report: ClassificationReport; title?: string }) {
  const at = report.at_trading_threshold;
  return (
    // Wraps instead of squeezing: the card is also used in half-width columns (model detail).
    <div className="flex flex-wrap items-start gap-6">
      <ConfusionMatrix report={report} />
      <div className="min-w-[260px] flex-1 space-y-2 text-sm">
        <div className="font-medium text-fg">{title}</div>
        <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 tabular">
          <span className="text-muted">Accuracy</span>
          <span className="text-fg">{pct(report.accuracy, 1)}</span>
          <span className="text-muted">ROC AUC</span>
          <span className="text-fg">{num(report.roc_auc, 3)}</span>
          <span className="text-muted">Precision / recall</span>
          <span className="text-fg">
            {pct(report.precision, 1)} / {pct(report.recall, 1)}
          </span>
          <span className="text-muted">Base rate (up)</span>
          <span className="text-fg">{pct(report.base_rate, 1)}</span>
          <span className="text-muted">Samples</span>
          <span className="text-fg">{report.n}</span>
          {at && (
            <>
              <span className="text-muted">At threshold {num(at.threshold, 2)}</span>
              <span className="text-fg">
                precision {pct(at.precision, 1)}, in market {pct(at.predicted_positive_rate, 0)} of bars
              </span>
            </>
          )}
        </div>
        <p className="text-xs text-muted">
          Accuracy measures direction calls at 0.5. Profit depends on the size of the moves you catch and on costs, so compare these numbers with the Sharpe ratio, not instead of it.
        </p>
      </div>
    </div>
  );
}

export function BacktestResults({ run }: { run: BacktestResponse }) {
  const { mode } = useTheme();
  const [tab, setTab] = useState<Tab>("performance");
  const priceRef = useRef<PriceChartHandle>(null);
  const intraday = isIntraday(run.interval);
  const color = strategyColor(run.strategy.key, mode);
  const bhColor = strategyColor("buy_hold", mode);
  const s = run.series;

  const equitySeries = useMemo(
    () => [
      { key: "strategy", label: run.strategy.label, color, values: s.equity },
      ...(s.benchmark_equity ? [{ key: "bh", label: "Buy & Hold", color: bhColor, values: s.benchmark_equity, dim: true }] : []),
    ],
    [run, color, bhColor, s],
  );
  const ddSeries = useMemo(
    () => [
      { key: "strategy", label: run.strategy.label, color, values: s.drawdown, area: true },
      ...(s.benchmark_drawdown ? [{ key: "bh", label: "Buy & Hold", color: bhColor, values: s.benchmark_drawdown, dim: true }] : []),
    ],
    [run, color, bhColor, s],
  );

  const tabs: { value: Tab; label: string }[] = [
    { value: "performance", label: "Performance" },
    { value: "trades_chart", label: "Trades on price" },
    { value: "monthly", label: "Monthly returns" },
    { value: "trades", label: `Trade log (${run.trades.length})` },
    { value: "metrics", label: "All metrics" },
  ];
  if (run.diagnostics) tabs.push({ value: "ml", label: "ML diagnostics" });

  const final = (vals: (number | null)[] | undefined) => {
    if (!vals?.length) return "";
    const v = vals[vals.length - 1];
    return v == null ? "" : pct(v / run.execution.initial_capital - 1, 1, true);
  };

  return (
    <div className="space-y-4">
      <RunHeader run={run} />
      <KpiTiles metrics={run.metrics} benchmark={run.benchmark_metrics} />
      <Card>
        <Tabs value={tab} tabs={tabs} onChange={setTab} />
        <div className="p-4">
          {tab === "performance" && (
            <div className="space-y-6">
              <div>
                <div className="mb-1 text-sm font-medium text-fg">Equity curve</div>
                <TimeSeriesChart
                  timestamps={s.timestamp}
                  series={equitySeries}
                  yFormat={(v) => money(v)}
                  intraday={intraday}
                  height={300}
                  legendValue={(x) => final(x.values)}
                  exportName={`equity_${run.symbol}_${run.strategy.key}`}
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-medium text-fg">Drawdown</div>
                <TimeSeriesChart
                  timestamps={s.timestamp}
                  series={ddSeries}
                  yFormat={(v) => pct(v, 0)}
                  intraday={intraday}
                  height={180}
                  zeroLine
                  exportName={`drawdown_${run.symbol}_${run.strategy.key}`}
                />
              </div>
            </div>
          )}
          {tab === "trades_chart" && (
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>
                  <span style={{ color: CHROME[mode].buy }}>▲ B</span> = buy fill at the next bar's open, <span style={{ color: CHROME[mode].sell }}>▼ S</span> = sell fill. Final
                  forced exit at the last close is not marked.
                </span>
                <button
                  className="inline-flex items-center gap-1 hover:text-fg"
                  onClick={() => {
                    const canvas = priceRef.current?.screenshot();
                    if (canvas) downloadCanvas(canvas, `price_${run.symbol}.png`);
                  }}
                >
                  <Download className="size-3.5" /> PNG
                </button>
              </div>
              <PriceChart
                handle={priceRef}
                timestamps={s.timestamp}
                open={s.open}
                high={s.high}
                low={s.low}
                close={s.close}
                volume={s.volume}
                fills={run.fills}
                intraday={intraday}
                height={440}
              />
            </div>
          )}
          {tab === "monthly" && <MonthlyHeatmap data={run.monthly_returns} />}
          {tab === "trades" && <TradesTable trades={run.trades} filename={`trades_${run.symbol}_${run.strategy.key}.csv`} intraday={intraday} />}
          {tab === "metrics" && (
            <MetricsTable
              columns={[
                { key: "s", label: run.strategy.label, color, metrics: run.metrics },
                ...(run.benchmark_metrics ? [{ key: "bh", label: "Buy & Hold", color: bhColor, metrics: run.benchmark_metrics }] : []),
              ]}
              rows={[...COMPARE_KEYS, "sortino", "max_drawdown_duration_days", "avg_trade_return", "avg_bars_held", "skew", "kurtosis", "final_equity"].filter((k, i, a) => a.indexOf(k) === i)}
            />
          )}
          {tab === "ml" && run.diagnostics && <DiagnosticsCard report={run.diagnostics} />}
        </div>
      </Card>
      <Card>
        <CardHeader title="Strategy settings" />
        <div className="flex flex-wrap gap-2 px-4 pb-4 text-xs">
          {Object.entries(run.strategy.params).map(([k, v]) => (
            <Badge key={k} tone="neutral">
              {k}: {v === null ? "auto" : String(v)}
            </Badge>
          ))}
          <Badge tone="neutral">initial capital: {money(run.execution.initial_capital)}</Badge>
          <Badge tone="neutral">risk-free: {pct(run.risk_free_rate, 1)}</Badge>
          {run.model_ids.map((m) => (
            <Badge key={m} tone="accent">
              model: {m}
            </Badge>
          ))}
        </div>
      </Card>
    </div>
  );
}
