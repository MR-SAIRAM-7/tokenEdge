import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, CandlestickChart, CheckCircle2, Download, Info, RefreshCw, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useMarketsOverview } from "../api/queries";
import type { OhlcvResponse, QualityReport } from "../api/types";
import { PriceChart, type Overlay, type PriceChartHandle } from "../components/charts/PriceChart";
import { useToast } from "../components/Toast";
import { Alert, Button, Card, CardHeader, PageHeader, Segmented, Skeleton, StatTile } from "../components/ui";
import { strategyColor } from "../lib/colors";
import { downloadCanvas, downloadCsv } from "../lib/download";
import { date, int, isIntraday, pct, price } from "../lib/format";
import { useMarket } from "../state/market";
import { useTheme } from "../state/theme";

type Range = "3m" | "1y" | "3y" | "5y" | "all";
const BARS_PER_DAY = (interval: string) => (interval.endsWith("h") ? 24 / Number(interval.slice(0, -1) || 1) : 1);

function rangeLimit(range: Range, interval: string): number | undefined {
  const days = { "3m": 92, "1y": 365, "3y": 365 * 3, "5y": 365 * 5, all: 0 }[range];
  if (!days) return undefined;
  const perDay = BARS_PER_DAY(interval);
  const tradingFactor = interval.endsWith("d") ? 252 / 365 : 1;
  return Math.max(10, Math.round(days * perDay * tradingFactor));
}

const INDICATORS = [
  { key: "sma:20", label: "SMA 20" },
  { key: "sma:50", label: "SMA 50" },
  { key: "sma:200", label: "SMA 200" },
  { key: "ema:20", label: "EMA 20" },
  { key: "bb:20", label: "Bollinger 20" },
  { key: "rsi:14", label: "RSI 14" },
  { key: "macd", label: "MACD" },
  { key: "ffd:0.4", label: "Frac-diff d=0.4" },
];

export default function DataExplorer() {
  const market = useMarket();
  const { mode } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const chartRef = useRef<PriceChartHandle>(null);
  const intraday = isIntraday(market.interval);
  const [range, setRange] = useState<Range>(intraday ? "3m" : "3y");
  const [active, setActive] = useState<string[]>(["sma:20", "sma:50"]);
  const [showVolume, setShowVolume] = useState(true);
  const limit = rangeLimit(range, market.interval);
  const base = { symbol: market.symbol, source: market.source, interval: market.interval };
  const { data: overview } = useMarketsOverview();
  const ov = overview?.find((o) => o.symbol === market.symbol && o.source === market.source && o.interval === market.interval);

  const ohlcv = useQuery({
    queryKey: ["ohlcv", base, limit],
    queryFn: () => api.get<OhlcvResponse>("/data/ohlcv", { ...base, limit }),
  });
  const indicators = useQuery({
    queryKey: ["indicators", base, limit, active],
    queryFn: () => api.get<{ timestamp: number[]; series: Record<string, (number | null)[]> }>("/data/indicators", { ...base, limit, indicators: active.join(",") }),
    enabled: active.length > 0 && ohlcv.isSuccess,
    placeholderData: keepPreviousData,
  });
  const quality = useQuery({
    queryKey: ["quality", base],
    queryFn: () => api.get<QualityReport>("/data/quality", base),
  });
  const refresh = useMutation({
    mutationFn: () => api.post<{ bars: number; end: string }>("/data/refresh", base),
    onSuccess: (r) => {
      toast(`Data updated: ${r.bars.toLocaleString()} bars through ${date(r.end)}.`, "ok");
      qc.invalidateQueries({ queryKey: ["ohlcv"] });
      qc.invalidateQueries({ queryKey: ["indicators"] });
      qc.invalidateQueries({ queryKey: ["quality"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const d = ohlcv.data;
  const series = useMemo(() => (active.length ? indicators.data?.series ?? {} : {}), [indicators.data, active.length]);
  const overlayPalette = useMemo(() => ["sma_crossover", "xgboost", "lstm", "buy_hold"].map((k) => strategyColor(k, mode)), [mode]);

  const overlays = useMemo<Overlay[]>(() => {
    const out: Overlay[] = [];
    let i = 0;
    for (const [name, values] of Object.entries(series)) {
      if (name.startsWith("sma_") || name.startsWith("ema_")) out.push({ name: name.replace("_", " ").toUpperCase(), values, color: overlayPalette[i++ % overlayPalette.length] });
      if (name === "bb_upper" || name === "bb_lower") out.push({ name: name === "bb_upper" ? "BB upper" : "BB lower", values, color: overlayPalette[3] });
    }
    return out;
  }, [series, overlayPalette]);

  const rsi = active.includes("rsi:14") ? series["rsi_14"] ?? null : null;
  const macd = active.includes("macd") && series["macd"] ? { macd: series["macd"], signal: series["macd_signal"], hist: series["macd_hist"] } : null;
  const ffd = active.includes("ffd:0.4") ? series["ffd_0.4"] ?? null : null;

  const stats = useMemo(() => {
    if (!d || d.close.length < 2) return null;
    const closes = d.close.filter((x): x is number => x !== null);
    const first = closes[0];
    const last = closes[closes.length - 1];
    const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    const ppy = market.source === "ccxt" ? 365 * BARS_PER_DAY(market.interval) : market.interval.endsWith("h") ? 252 * 6.5 : 252;
    return { first, last, change: last / first - 1, vol: sd * Math.sqrt(ppy), high: Math.max(...closes), low: Math.min(...closes) };
  }, [d, market.source, market.interval]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<CandlestickChart className="size-5" />}
        eyebrow="Data"
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            {market.symbol}
            <span className="text-base font-normal text-muted">{ov?.name ?? market.interval}</span>
          </span>
        }
        subtitle="Prices, indicators and data quality. Data comes from the local cache or the bundled snapshot; Refresh pulls new bars from the source."
        actions={
          <>
            <Button icon={<RefreshCw className="size-4" />} loading={refresh.isPending} onClick={() => refresh.mutate()}>
              Refresh data
            </Button>
            <Button
              icon={<Download className="size-4" />}
              disabled={!d}
              onClick={() =>
                d &&
                downloadCsv(
                  d.timestamp.map((t, i) => ({ timestamp: new Date(t * 1000).toISOString(), open: d.open[i], high: d.high[i], low: d.low[i], close: d.close[i], volume: d.volume[i] })),
                  `${market.symbol.replace("/", "-")}_${market.interval}.csv`,
                )
              }
            >
              CSV
            </Button>
          </>
        }
      />

      {ov && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Last close" value={<span className="tabular">{price(ov.last_close)}</span>} sub={date(ov.last_time, intraday)} />
          <StatTile label="1 day" value={pct(ov.change_1d, 2, true)} tone={(ov.change_1d ?? 0) >= 0 ? "pos" : "neg"} />
          <StatTile label="30 days" value={pct(ov.change_30d, 1, true)} tone={(ov.change_30d ?? 0) >= 0 ? "pos" : "neg"} />
          <StatTile label="1 year" value={pct(ov.change_1y, 1, true)} tone={(ov.change_1y ?? 0) >= 0 ? "pos" : "neg"} />
          <StatTile label="Volatility (1Y)" value={pct(ov.volatility_1y, 1)} sub="annualized" />
          <StatTile label="History" value={int(ov.bars)} sub={`${market.interval} bars`} />
        </div>
      )}

      <Card data-tour="price-chart">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented<Range>
            value={range}
            onChange={setRange}
            size="sm"
            options={[
              { value: "3m", label: "3M" },
              { value: "1y", label: "1Y" },
              { value: "3y", label: "3Y" },
              { value: "5y", label: "5Y" },
              { value: "all", label: "All" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {INDICATORS.map((ind) => {
              const on = active.includes(ind.key);
              return (
                <button
                  key={ind.key}
                  onClick={() => setActive((a) => (on ? a.filter((x) => x !== ind.key) : [...a, ind.key]))}
                  aria-pressed={on}
                  className={clsx(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    on ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-fg-2 hover:text-fg",
                  )}
                >
                  {ind.label}
                </button>
              );
            })}
            <button
              onClick={() => setShowVolume(!showVolume)}
              aria-pressed={showVolume}
              className={clsx(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                showVolume ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-fg-2 hover:text-fg",
              )}
            >
              Volume
            </button>
          </div>
          <button
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
            onClick={() => {
              const c = chartRef.current?.screenshot();
              if (c) downloadCanvas(c, `${market.symbol.replace("/", "-")}_chart.png`);
            }}
          >
            <Download className="size-3.5" /> PNG
          </button>
        </div>
        <div className="p-3">
          {ohlcv.isLoading && <Skeleton className="h-[440px]" />}
          {ohlcv.error && <Alert tone="error" title="Could not load data">{(ohlcv.error as Error).message}</Alert>}
          {d && (
            <PriceChart
              handle={chartRef}
              timestamps={d.timestamp}
              open={d.open}
              high={d.high}
              low={d.low}
              close={d.close}
              volume={showVolume ? d.volume : undefined}
              overlays={overlays}
              rsi={rsi}
              macd={macd}
              ffd={ffd}
              intraday={intraday}
              height={440}
            />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <CardHeader title="Summary" subtitle={d ? `${int(d.bars)} bars shown` : undefined} />
          {stats && d ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 pb-4 text-sm tabular">
              <dt className="text-muted">Range</dt>
              <dd className="text-fg">
                {date(d.timestamp[0], intraday)} → {date(d.timestamp[d.timestamp.length - 1], intraday)}
              </dd>
              <dt className="text-muted">Last close</dt>
              <dd className="text-fg">{price(stats.last)}</dd>
              <dt className="text-muted">Change over range</dt>
              <dd className={stats.change >= 0 ? "text-pos" : "text-neg"}>{pct(stats.change, 1, true)}</dd>
              <dt className="text-muted">High / low close</dt>
              <dd className="text-fg">
                {price(stats.high)} / {price(stats.low)}
              </dd>
              <dt className="text-muted">Annualized volatility</dt>
              <dd className="text-fg">{pct(stats.vol, 1)}</dd>
              <dt className="text-muted">Data hash</dt>
              <dd className="truncate font-mono text-[11px] text-fg-2" title={d.data_hash}>
                {d.data_hash}
              </dd>
            </dl>
          ) : (
            <div className="px-4 pb-4">
              <Skeleton className="h-32" />
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Data quality" subtitle="Full cached history for this symbol" />
          <div className="px-4 pb-4">
            {quality.data ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
                  {[
                    ["Bars", int(quality.data.bars)],
                    ["Missing", quality.data.missing_bars == null ? "—" : int(quality.data.missing_bars)],
                    ["Duplicates", int(quality.data.duplicates)],
                    ["Bad prices", int(quality.data.non_positive_prices)],
                    ["Zero volume", int(quality.data.zero_volume_bars)],
                    ["> 5σ moves", int(quality.data.outliers?.length ?? 0)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-panel-2 px-2 py-2">
                      <div className="tabular text-sm font-semibold text-fg">{v}</div>
                      <div className="text-muted">{k}</div>
                    </div>
                  ))}
                </div>
                <ul className="space-y-1.5 text-sm">
                  {quality.data.issues.length === 0 && (
                    <li className="flex items-center gap-2 text-fg-2">
                      <CheckCircle2 className="size-4 text-pos" /> No issues found.
                    </li>
                  )}
                  {quality.data.issues.map((i) => (
                    <li key={i.check} className="flex items-start gap-2 text-fg-2">
                      {i.severity === "error" ? (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-neg" />
                      ) : i.severity === "warning" ? (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                      ) : (
                        <Info className="mt-0.5 size-4 shrink-0 text-muted" />
                      )}
                      <span>
                        <span className="font-medium text-fg capitalize">{i.severity}</span> · {i.message}
                      </span>
                    </li>
                  ))}
                </ul>
                {quality.data.outliers && quality.data.outliers.length > 0 && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer hover:text-fg">Largest moves</summary>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">
                      {quality.data.outliers.slice(0, 15).map((o) => (
                        <span key={o.timestamp} className="tabular">
                          {date(o.timestamp, intraday)}: {pct(o.return, 1, true)}
                        </span>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : quality.error ? (
              <Alert tone="error">{(quality.error as Error).message}</Alert>
            ) : (
              <Skeleton className="h-32" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
