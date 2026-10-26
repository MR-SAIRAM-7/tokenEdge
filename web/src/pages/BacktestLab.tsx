import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { FlaskConical, Link2, PanelLeftClose, PanelLeftOpen, Play, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { useModels, useStrategies } from "../api/queries";
import type { BacktestResponse, ExecutionIn, ModelSummary, Source, TuneResult, WindowName } from "../api/types";
import { BacktestResults } from "../components/BacktestResults";
import { SmaGridHeatmap } from "../components/charts/Grids";
import { cleanExecution, DEFAULT_EXECUTION, defaultParams, ExecutionPanel, StrategyParamsForm, usableModels, WindowPicker } from "../components/Forms";
import { ProgressSteps } from "../components/ProgressSteps";
import { useToast } from "../components/Toast";
import { Alert, Button, Card, Checkbox, EmptyState, Field, PageHeader, Select, Skeleton } from "../components/ui";
import { num } from "../lib/format";
import { copyText, decodeConfig, encodeConfig, shareUrl } from "../lib/share";
import { marketKey, useMarket, type Market } from "../state/market";

interface Scenario {
  id: string;
  label: string;
  description: string;
  market: Market;
  strategy: string;
  params: (models: ModelSummary[]) => Record<string, unknown> | null;
  window: WindowName;
  execution?: ExecutionIn;
  allowInSample?: boolean;
  dates?: { start: string; end: string };
  autoRun?: boolean;
}

/** What the URL's `config` parameter holds: everything needed to reproduce the form. */
interface LabConfig {
  market: Market;
  strategy: string;
  params: Record<string, unknown>;
  window: WindowName;
  start?: string;
  end?: string;
  execution: ExecutionIn;
  allowInSample?: boolean;
}

function sharedScenario(c: LabConfig | null): Scenario | null {
  if (!c?.market?.symbol || !c.strategy) return null;
  return {
    id: "shared",
    label: "Shared configuration",
    description: "",
    market: c.market,
    strategy: c.strategy,
    params: () => c.params ?? {},
    window: c.window ?? "test",
    execution: c.execution,
    allowInSample: c.allowInSample,
    dates: { start: c.start ?? "", end: c.end ?? "" },
    autoRun: false,
  };
}

const modelFor = (models: ModelSummary[], type: string, symbol: string) => models.find((m) => m.model_type === type && m.symbol === symbol)?.model_id;

const SCENARIOS: Scenario[] = [
  { id: "golden", label: "SPY golden cross", description: "SMA 50/200 on the S&P 500 ETF, test window", market: { symbol: "SPY", source: "yfinance", interval: "1d" }, strategy: "sma_crossover", params: () => ({ fast: 50, slow: 200, ma_type: "sma" }), window: "test" },
  { id: "btc-ema", label: "BTC hourly EMA", description: "EMA 24/168 on Bitcoin hourly bars", market: { symbol: "BTC/USDT", source: "ccxt" as Source, interval: "1h" }, strategy: "sma_crossover", params: () => ({ fast: 24, slow: 168, ma_type: "ema" }), window: "test" },
  { id: "nse", label: "NSE costs, long/short", description: "TCS with STT and stamp duty, shorting allowed", market: { symbol: "TCS.NS", source: "yfinance", interval: "1d" }, strategy: "sma_crossover", params: () => ({ fast: 20, slow: 100, ma_type: "sma" }), window: "test", execution: { ...DEFAULT_EXECUTION, preset: "india_equity_nse", mode: "long_short", borrow_rate: 0.02 } },
  { id: "xgb", label: "XGBoost · SPY", description: "Gradient-boosted model on its held-out window", market: { symbol: "SPY", source: "yfinance", interval: "1d" }, strategy: "xgboost", params: (m) => (modelFor(m, "xgboost", "SPY") ? { model_id: modelFor(m, "xgboost", "SPY") } : null), window: "model_test" },
  { id: "filter", label: "SMA + XGBoost filter", description: "SMA 20/50 on SPY, longs only when XGBoost agrees", market: { symbol: "SPY", source: "yfinance", interval: "1d" }, strategy: "sma_ml_filter", params: (m) => (modelFor(m, "xgboost", "SPY") ? { fast: 20, slow: 50, model_id: modelFor(m, "xgboost", "SPY") } : null), window: "model_test" },
  { id: "lstm", label: "LSTM · RELIANCE", description: "Recurrent network on Reliance, held-out window", market: { symbol: "RELIANCE.NS", source: "yfinance", interval: "1d" }, strategy: "lstm", params: (m) => (modelFor(m, "lstm", "RELIANCE.NS") ? { model_id: modelFor(m, "lstm", "RELIANCE.NS") } : null), window: "model_test" },
  { id: "leak", label: "In-sample trap", description: "XGBoost on its validation data: see the warning", market: { symbol: "SPY", source: "yfinance", interval: "1d" }, strategy: "xgboost", params: (m) => (modelFor(m, "xgboost", "SPY") ? { model_id: modelFor(m, "xgboost", "SPY") } : null), window: "val", allowInSample: true },
];

export default function BacktestLab() {
  const market = useMarket();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const { data: strategies } = useStrategies();
  const { data: models = [], isFetched: modelsReady } = useModels();
  // Read the URL once: links from other pages pass ?strategy=&model=, shared links ?config=.
  const fromUrl = useRef({ model: search.get("model"), shared: sharedScenario(decodeConfig<LabConfig>(search.get("config"))) });

  const [name, setName] = useState(fromUrl.current.shared?.strategy ?? search.get("strategy") ?? "sma_crossover");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [windowName, setWindowName] = useState<WindowName>("test");
  const [dates, setDates] = useState({ start: "", end: "" });
  const [execution, setExecution] = useState<ExecutionIn>(DEFAULT_EXECUTION);
  const [allowInSample, setAllowInSample] = useState(false);
  const [tune, setTune] = useState<TuneResult | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [showConfig, setShowConfig] = useState(true);
  const [pending, setPending] = useState<Scenario | null>(fromUrl.current.shared);
  const [autoRun, setAutoRun] = useState(false);

  const strategy = strategies?.find((s) => s.name === name);
  const isML = strategy?.kind === "ml";
  const mk = marketKey(market);

  // Reset parameters when the strategy, market or available models change.
  useEffect(() => {
    if (!strategy) return;
    const p = defaultParams(strategy, models, market.symbol, market.interval);
    const model = fromUrl.current.model;
    if (strategy.kind === "ml" && model && models.some((m) => m.model_id === model)) p.model_id = model;
    setParams(p);
    setWindowName(strategy.kind === "ml" ? "model_test" : "test");
    setTune(null);
  }, [strategy?.name, mk, models.length]);

  // Apply a quick scenario once its market and strategy are active (runs after the reset above).
  useEffect(() => {
    if (!pending || !strategy || !modelsReady) return;
    if (marketKey(pending.market) !== mk || pending.strategy !== strategy.name) return;
    setParams({ ...defaultParams(strategy, models, market.symbol, market.interval), ...(pending.params(models) ?? {}) });
    setWindowName(pending.window);
    setExecution(pending.execution ?? DEFAULT_EXECUTION);
    setAllowInSample(!!pending.allowInSample);
    if (pending.dates) setDates(pending.dates);
    setPending(null);
    setAutoRun(pending.autoRun !== false);
  }, [pending, strategy?.name, mk, models.length, modelsReady]);

  // A shared link may point at another market than the one last used here.
  useEffect(() => {
    const shared = fromUrl.current.shared;
    if (shared && marketKey(shared.market) !== mk) market.setMarket(shared.market);
  }, []);

  const config = (): LabConfig => ({
    market: { symbol: market.symbol, source: market.source, interval: market.interval },
    strategy: name,
    params,
    window: windowName,
    ...(windowName === "custom" ? { start: dates.start, end: dates.end } : {}),
    execution,
    ...(allowInSample ? { allowInSample } : {}),
  });

  // Keep the form in the URL so the address bar always holds a shareable link to this setup.
  useEffect(() => {
    if (!strategy || pending) return;
    const value = encodeConfig(config());
    if (search.get("config") !== value) setSearch({ config: value }, { replace: true });
  }, [strategy?.name, params, windowName, dates, execution, allowInSample, mk, pending]);

  const copyLink = async () => {
    const ok = await copyText(shareUrl("/backtest", config()));
    toast(ok ? "Link copied: it opens the Backtest Lab with this exact configuration." : "Could not access the clipboard; copy the address bar instead.", ok ? "ok" : "info");
  };

  useEffect(() => setResult(null), [mk]);

  const run = useMutation({
    mutationFn: () =>
      api.post<BacktestResponse>("/backtest", {
        ...market,
        window: windowName,
        start: windowName === "custom" ? dates.start || null : null,
        end: windowName === "custom" ? dates.end || null : null,
        strategy: { name, params },
        execution: cleanExecution(execution),
        allow_in_sample: allowInSample,
      }),
    onSuccess: (r) => {
      setResult(r);
      ["runs", "models"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  useEffect(() => {
    if (autoRun) {
      setAutoRun(false);
      run.mutate();
    }
  }, [autoRun]);

  const tuneMut = useMutation({
    mutationFn: () => api.post<TuneResult>("/tune/sma", { ...market, execution: cleanExecution(execution), ma_type: (params.ma_type as string) ?? "sma" }),
    onSuccess: (r) => {
      setTune(r);
      setParams((p) => ({ ...p, fast: r.best.fast, slow: r.best.slow }));
      toast(`Best on validation: SMA ${r.best.fast}/${r.best.slow} (Sharpe ${num(r.best_val_sharpe)}). ${r.trials} configurations tried.`, "ok");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const missingModel = isML && !params.model_id;
  const mlModels = useMemo(() => usableModels(strategy, models), [models, strategy]);

  const applyScenario = (s: Scenario) => {
    if (!s.params(models)) return;
    setPending(s);
    setName(s.strategy);
    if (marketKey(s.market) !== mk) market.setMarket(s.market);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<FlaskConical className="size-5" />}
        eyebrow="Research"
        title="Backtest Lab"
        subtitle="Run one strategy with realistic costs. Signals from bar t fill at the open of bar t+1, and any open position is closed at the last bar of the window."
        actions={
          !showConfig ? (
            <Button icon={<PanelLeftOpen className="size-4" />} onClick={() => setShowConfig(true)}>
              Show configuration
            </Button>
          ) : undefined
        }
      />

      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
          <Sparkles className="size-3.5 text-accent" /> Quick scenarios: one click sets everything up and runs it
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SCENARIOS.map((s) => {
            const available = !!s.params(models);
            return (
              <button
                key={s.id}
                disabled={!available || run.isPending}
                onClick={() => applyScenario(s)}
                title={available ? s.description : "Needs a trained model for this market"}
                className={clsx(
                  "min-w-[190px] shrink-0 rounded-xl border bg-panel px-3.5 py-2.5 text-left shadow-card transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  s.id === "leak" ? "border-warn/40 hover:border-warn" : "border-line hover:border-accent/60",
                )}
              >
                <div className="text-sm font-semibold text-fg">{s.label}</div>
                <div className="mt-0.5 text-xs leading-snug text-muted">{s.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className={clsx("grid items-start gap-5", showConfig && "xl:grid-cols-[370px_minmax(0,1fr)]")}>
        {showConfig && (
          <Card className="xl:sticky xl:top-20" data-tour="backtest-config">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div>
                <div className="text-sm font-semibold text-fg">Configuration</div>
                <div className="text-xs text-muted">
                  {market.symbol} · {market.interval}
                </div>
              </div>
              {result && (
                <button className="text-muted hover:text-fg" onClick={() => setShowConfig(false)} title="Hide configuration">
                  <PanelLeftClose className="size-4" />
                </button>
              )}
            </div>
            <div className="space-y-4 px-4 pb-4">
              {!strategies ? (
                <Skeleton className="h-40" />
              ) : (
                <>
                  <Field label="Strategy">
                    <Select value={name} onChange={(e) => setName(e.target.value)}>
                      {strategies.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {strategy && <p className="-mt-2 text-xs leading-relaxed text-muted">{strategy.description}</p>}
                  {strategy && <StrategyParamsForm strategy={strategy} params={params} onChange={setParams} models={models} />}

                  {isML && mlModels.length === 0 && (
                    <Alert tone="info" title="No trained model">
                      Train one first. <Link to="/models" className="font-medium text-accent hover:underline">How to train →</Link>
                    </Alert>
                  )}

                  {(name === "sma_crossover" || name === "sma_ml_filter") && (
                    <div className="space-y-2 rounded-xl border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-fg-2">Choose windows on train/validation data only.</div>
                        <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={tuneMut.isPending} onClick={() => tuneMut.mutate()}>
                          Auto-tune
                        </Button>
                      </div>
                      {tune && (
                        <div className="space-y-1">
                          <div className="text-[11px] text-muted">Validation Sharpe by (fast, slow). Outlined = selected.</div>
                          <SmaGridHeatmap result={tune} selected={{ fast: params.fast as number, slow: params.slow as number }} />
                        </div>
                      )}
                    </div>
                  )}

                  <Field label="Window">
                    <WindowPicker value={windowName} onChange={setWindowName} start={dates.start} end={dates.end} onDates={(start, end) => setDates({ start, end })} hasModel={!!isML} />
                  </Field>

                  <ExecutionPanel value={execution} onChange={setExecution} />

                  {isML && (
                    <Checkbox
                      checked={allowInSample}
                      onChange={setAllowInSample}
                      label="Allow in-sample window"
                      help="By default the API refuses to backtest an ML model on bars it was trained or validated on. Turn this on only to see how optimistic in-sample results look."
                    />
                  )}

                  <div className="flex gap-2">
                    <Button variant="primary" className="flex-1" icon={<Play className="size-4" />} loading={run.isPending} disabled={missingModel} onClick={() => run.mutate()}>
                      Run backtest
                    </Button>
                    <Button icon={<Link2 className="size-4" />} onClick={copyLink} title="Copy a link to this configuration">
                      Share
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        )}

        <div className="min-w-0">
          {run.isPending ? (
            <ProgressSteps
              title={`Backtesting ${strategy?.label ?? name} on ${market.symbol}`}
              steps={["Loading market data", isML ? "Running the model on every bar" : "Computing indicators and signals", "Filling orders at the next bar's open", "Computing metrics and the Buy & Hold benchmark"]}
              intervalMs={500}
            />
          ) : result ? (
            <BacktestResults key={result.run_id} run={result} />
          ) : (
            <Card>
              <EmptyState icon={<FlaskConical className="size-8" />} title="Pick a quick scenario or configure a strategy">
                Results include the equity curve against Buy &amp; Hold, drawdowns, trade markers on the price chart, monthly returns and a full trade log. Every run is saved to Run History.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
