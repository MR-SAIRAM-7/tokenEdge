import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, GitCompareArrows, Link2, PanelLeftClose, PanelLeftOpen, Play, Wand2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { useModels } from "../api/queries";
import type { CompareResponse, ExecutionIn, StrategySpec, TuneResult, WindowName } from "../api/types";
import { CompareResults } from "../components/CompareResults";
import { cleanExecution, DEFAULT_EXECUTION, ExecutionPanel, WindowPicker } from "../components/Forms";
import { ProgressSteps } from "../components/ProgressSteps";
import { useToast } from "../components/Toast";
import { Alert, Button, Card, EmptyState, Field, NumberInput, PageHeader, Select } from "../components/ui";
import { strategyColor } from "../lib/colors";
import { num } from "../lib/format";
import { copyText, decodeConfig, encodeConfig, shareUrl } from "../lib/share";
import { marketKey, useMarket, type Market } from "../state/market";
import { useTheme } from "../state/theme";

function StrategyCard({
  k,
  title,
  description,
  checked,
  onToggle,
  disabled,
  children,
}: {
  k: string;
  title: string;
  description: string;
  checked: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { mode } = useTheme();
  return (
    <div className={clsx("rounded-xl border p-3 transition-colors", checked ? "border-accent/50 bg-accent-soft/40" : "border-line", disabled && "opacity-60")}>
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={onToggle} disabled={disabled || !onToggle}>
        <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: strategyColor(k, mode) }} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg">{title}</span>
          <span className="block text-xs leading-snug text-muted">{description}</span>
        </span>
        {onToggle && (
          <span className={clsx("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border", checked ? "border-accent bg-accent text-white" : "border-line")}>
            {checked && <Check className="size-3.5" />}
          </span>
        )}
      </button>
      {children && <div className="mt-3 pl-4">{children}</div>}
    </div>
  );
}

/** What the URL's `config` parameter holds: everything needed to reproduce the setup. */
interface CompareConfig {
  market: Market;
  bh: boolean;
  sma: { use: boolean; fast: number; slow: number; trials?: number; trial_sharpe_std?: number | null };
  xgb: string;
  lstm: string;
  filter: string;
  window: WindowName;
  start?: string;
  end?: string;
  execution: ExecutionIn;
  samples: number;
}

type SmaStats = { trials: number; trial_sharpe_std: number | null };

export default function Compare() {
  const market = useMarket();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const { data: models = [], isLoading: modelsLoading } = useModels();

  const [useBH, setUseBH] = useState(true);
  const [useSMA, setUseSMA] = useState(true);
  const [sma, setSma] = useState({ fast: 20, slow: 50 });
  const [tune, setTune] = useState<TuneResult | null>(null);
  const [smaStats, setSmaStats] = useState<SmaStats | null>(null);
  const [xgb, setXgb] = useState<string>("");
  const [lstm, setLstm] = useState<string>("");
  const [filterModel, setFilterModel] = useState<string>("");
  const [windowName, setWindowName] = useState<WindowName>("model_test");
  const [dates, setDates] = useState({ start: "", end: "" });
  const [execution, setExecution] = useState<ExecutionIn>(DEFAULT_EXECUTION);
  const [samples, setSamples] = useState(5000);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [showSetup, setShowSetup] = useState(true);
  const autorun = useRef(search.get("autorun") === "1");
  const shared = useRef(decodeConfig<CompareConfig>(search.get("config")));
  const keepWindow = useRef(false);

  const xgbModels = models.filter((m) => m.model_type === "xgboost");
  const lstmModels = models.filter((m) => m.model_type === "lstm");

  useEffect(() => {
    const pick = (list: typeof models) => (list.find((m) => m.symbol === market.symbol && m.interval === market.interval) ?? null)?.model_id ?? "";
    setXgb(pick(xgbModels));
    setLstm(pick(lstmModels));
    setFilterModel("");
    setTune(null);
    setSmaStats(null);
    setResult(null);
  }, [marketKey(market), models.length]);

  // Apply a shared link once its market is active and the models are known (after the reset above).
  useEffect(() => {
    const c = shared.current;
    if (!c?.market?.symbol) return;
    if (marketKey(c.market) !== marketKey(market)) {
      market.setMarket(c.market);
      return;
    }
    if (modelsLoading) return;
    shared.current = null;
    const known = (id: string) => (models.some((m) => m.model_id === id) ? id : "");
    setUseBH(c.bh !== false);
    setUseSMA(c.sma?.use !== false);
    if (c.sma?.fast && c.sma?.slow) setSma({ fast: c.sma.fast, slow: c.sma.slow });
    setSmaStats(c.sma?.trials ? { trials: c.sma.trials, trial_sharpe_std: c.sma.trial_sharpe_std ?? null } : null);
    setXgb(known(c.xgb ?? ""));
    setLstm(known(c.lstm ?? ""));
    setFilterModel(known(c.filter ?? ""));
    setWindowName(c.window ?? "model_test");
    setDates({ start: c.start ?? "", end: c.end ?? "" });
    setExecution(c.execution ?? DEFAULT_EXECUTION);
    if (c.samples) setSamples(c.samples);
    keepWindow.current = true;
  }, [marketKey(market), models.length, modelsLoading]);

  const hasModel = !!(xgb || lstm || filterModel);
  useEffect(() => {
    if (keepWindow.current) {
      keepWindow.current = false;
      return;
    }
    if (!hasModel && windowName === "model_test") setWindowName("test");
    if (hasModel && windowName === "test") setWindowName("model_test");
  }, [hasModel]);

  const config = (): CompareConfig => ({
    market: { symbol: market.symbol, source: market.source, interval: market.interval },
    bh: useBH,
    sma: { use: useSMA, ...sma, ...(smaStats ?? {}) },
    xgb,
    lstm,
    filter: filterModel,
    window: windowName,
    ...(windowName === "custom" ? { start: dates.start, end: dates.end } : {}),
    execution,
    samples,
  });

  // Keep the setup in the URL so the address bar always holds a shareable link to it.
  useEffect(() => {
    if (modelsLoading || shared.current) return;
    const value = encodeConfig(config());
    if (search.get("config") !== value) setSearch({ config: value }, { replace: true });
  }, [useBH, useSMA, sma, smaStats, xgb, lstm, filterModel, windowName, dates, execution, samples, marketKey(market), modelsLoading]);

  const copyLink = async () => {
    const ok = await copyText(shareUrl("/compare", config()));
    toast(ok ? "Link copied: it opens Compare with this exact setup." : "Could not access the clipboard; copy the address bar instead.", ok ? "ok" : "info");
  };

  const specs = (): StrategySpec[] => {
    const out: StrategySpec[] = [];
    if (useBH) out.push({ name: "buy_hold", params: {} });
    if (useSMA) out.push({ name: "sma_crossover", params: { ...sma }, ...(smaStats ?? {}) });
    if (xgb) out.push({ name: "xgboost", params: { model_id: xgb } });
    if (lstm) out.push({ name: "lstm", params: { model_id: lstm } });
    if (filterModel) out.push({ name: "sma_ml_filter", params: { ...sma, model_id: filterModel } });
    return out;
  };

  const run = useMutation({
    mutationFn: () =>
      api.post<CompareResponse>("/compare", {
        ...market,
        window: windowName,
        start: windowName === "custom" ? dates.start || null : null,
        end: windowName === "custom" ? dates.end || null : null,
        strategies: specs(),
        execution: cleanExecution(execution),
        statistics: { bootstrap_samples: samples, baseline: useSMA ? "sma_crossover" : null },
      }),
    onSuccess: (r) => {
      setResult(r);
      setShowSetup(false);
      ["runs", "models", "findings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const tuneMut = useMutation({
    mutationFn: () => api.post<TuneResult>("/tune/sma", { ...market, execution: cleanExecution(execution) }),
    onSuccess: (r) => {
      setTune(r);
      setSmaStats({ trials: r.trials, trial_sharpe_std: r.trial_sharpe_std });
      setSma({ fast: r.best.fast, slow: r.best.slow });
      toast(`SMA ${r.best.fast}/${r.best.slow} chosen on validation from ${r.trials} configurations. The trial count feeds the Deflated Sharpe.`, "ok");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  useEffect(() => {
    if (autorun.current && !modelsLoading) {
      autorun.current = false;
      setTimeout(() => run.mutate(), 0);
    }
  }, [modelsLoading]);

  const count = specs().length;

  const setup = (
    <Card className="xl:sticky xl:top-20" data-tour="compare-setup">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <div className="text-sm font-semibold text-fg">Setup</div>
          <div className="text-xs text-muted">
            {market.symbol} · {market.interval}
          </div>
        </div>
        {result && (
          <button className="text-muted hover:text-fg" onClick={() => setShowSetup(false)} title="Hide setup">
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>
      <div className="space-y-4 px-4 pb-4">
        <div className="space-y-2">
          <StrategyCard k="buy_hold" title="Buy & Hold" description="Benchmark: buy on the first bar, hold to the end." checked={useBH} onToggle={() => setUseBH(!useBH)} />
          <StrategyCard k="sma_crossover" title="SMA crossover" description="Classical baseline: long when the fast average is above the slow one." checked={useSMA} onToggle={() => setUseSMA(!useSMA)}>
            {useSMA && (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <Field label="Fast">
                    <NumberInput value={sma.fast} min={2} step={1} onChange={(v) => { setSma({ ...sma, fast: v ?? 20 }); setTune(null); setSmaStats(null); }} />
                  </Field>
                  <Field label="Slow">
                    <NumberInput value={sma.slow} min={3} step={1} onChange={(v) => { setSma({ ...sma, slow: v ?? 50 }); setTune(null); setSmaStats(null); }} />
                  </Field>
                  <Button icon={<Wand2 className="size-3.5" />} loading={tuneMut.isPending} onClick={() => tuneMut.mutate()} title="Grid search on train/validation">
                    Tune
                  </Button>
                </div>
                {tune ? (
                  <p className="text-[11px] text-muted">Tuned on validation (Sharpe {num(tune.best_val_sharpe)}), {tune.trials} trials counted for the DSR.</p>
                ) : smaStats ? (
                  <p className="text-[11px] text-muted">Tuned windows: {smaStats.trials} trials counted for the DSR.</p>
                ) : null}
              </div>
            )}
          </StrategyCard>
          <StrategyCard k="xgboost" title="XGBoost" description="Gradient-boosted trees on technical features." checked={!!xgb} disabled={!xgbModels.length}>
            <Select value={xgb} onChange={(e) => setXgb(e.target.value)} disabled={!xgbModels.length}>
              <option value="">{xgbModels.length ? "Not included" : "No XGBoost models yet"}</option>
              {xgbModels.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.model_id} ({m.symbol})
                </option>
              ))}
            </Select>
          </StrategyCard>
          <StrategyCard k="lstm" title="LSTM" description="Recurrent network over the last N bars." checked={!!lstm} disabled={!lstmModels.length}>
            <Select value={lstm} onChange={(e) => setLstm(e.target.value)} disabled={!lstmModels.length}>
              <option value="">{lstmModels.length ? "Not included" : "No LSTM models yet"}</option>
              {lstmModels.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.model_id} ({m.symbol})
                </option>
              ))}
            </Select>
          </StrategyCard>
          <StrategyCard
            k="sma_ml_filter"
            title="SMA + ML filter"
            description={`SMA ${sma.fast}/${sma.slow} picks the side; a model must agree before a trade is taken.`}
            checked={!!filterModel}
            disabled={!models.length}
          >
            <Select value={filterModel} onChange={(e) => setFilterModel(e.target.value)} disabled={!models.length}>
              <option value="">{models.length ? "Not included" : "No models yet"}</option>
              {[...models]
                .sort((a, b) => Number(b.symbol === market.symbol) - Number(a.symbol === market.symbol))
                .map((m) => (
                  <option key={m.model_id} value={m.model_id}>
                    {m.model_id} ({m.symbol}, {m.model_type})
                  </option>
                ))}
            </Select>
          </StrategyCard>
          {!models.length && !modelsLoading && (
            <p className="text-[11px] text-muted">
              Train models to add them. <Link className="text-accent hover:underline" to="/models">How →</Link>
            </p>
          )}
        </div>

        <Field label="Window">
          <WindowPicker value={windowName} onChange={setWindowName} start={dates.start} end={dates.end} onDates={(start, end) => setDates({ start, end })} hasModel={hasModel} />
        </Field>

        <ExecutionPanel value={execution} onChange={setExecution} />

        <Field label="Bootstrap resamples" help="More resamples give a smoother confidence interval but take longer.">
          <Select value={samples} onChange={(e) => setSamples(Number(e.target.value))}>
            {[1000, 2000, 5000, 10000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </Select>
        </Field>

        {count < 2 && <Alert tone="info">Pick at least two strategies to compare.</Alert>}
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" icon={<Play className="size-4" />} loading={run.isPending} disabled={count < 2} onClick={() => run.mutate()}>
            Run comparison
          </Button>
          <Button icon={<Link2 className="size-4" />} onClick={copyLink} title="Copy a link to this setup">
            Share
          </Button>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<GitCompareArrows className="size-5" />}
        eyebrow="Research"
        title="Compare strategies"
        subtitle="Classical baseline vs ML on the same held-out window and costs, with Probabilistic and Deflated Sharpe, a block-bootstrap test and cost sensitivity."
        actions={
          result && !showSetup ? (
            <Button icon={<PanelLeftOpen className="size-4" />} onClick={() => setShowSetup(true)}>
              Edit setup
            </Button>
          ) : undefined
        }
      />
      <div className={clsx("grid items-start gap-5", showSetup && "xl:grid-cols-[370px_minmax(0,1fr)]")}>
        {showSetup && setup}
        <div className="min-w-0">
          {run.isPending ? (
            <ProgressSteps
              title={`Comparing ${count} strategies on ${market.symbol}`}
              steps={["Loading market data", "Generating signals (models run through ONNX / XGBoost)", "Simulating trades with costs and slippage", "Bootstrapping the Sharpe differences", "Re-running at five cost levels"]}
            />
          ) : result ? (
            <CompareResults run={result} />
          ) : (
            <Card>
              <EmptyState icon={<GitCompareArrows className="size-8" />} title="Run a comparison">
                With trained models selected, the window defaults to the models' held-out test period, the only fair place to compare. Without models, SMA and Buy &amp; Hold are
                compared on the default test window.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
