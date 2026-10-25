import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, GitCompareArrows, PanelLeftClose, PanelLeftOpen, Play, Wand2 } from "lucide-react";
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
import { marketKey, useMarket } from "../state/market";
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
  const [xgb, setXgb] = useState<string>("");
  const [lstm, setLstm] = useState<string>("");
  const [windowName, setWindowName] = useState<WindowName>("model_test");
  const [dates, setDates] = useState({ start: "", end: "" });
  const [execution, setExecution] = useState<ExecutionIn>(DEFAULT_EXECUTION);
  const [samples, setSamples] = useState(5000);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [showSetup, setShowSetup] = useState(true);
  const autorun = useRef(search.get("autorun") === "1");

  const xgbModels = models.filter((m) => m.model_type === "xgboost");
  const lstmModels = models.filter((m) => m.model_type === "lstm");

  useEffect(() => {
    const pick = (list: typeof models) => (list.find((m) => m.symbol === market.symbol && m.interval === market.interval) ?? null)?.model_id ?? "";
    setXgb(pick(xgbModels));
    setLstm(pick(lstmModels));
    setTune(null);
    setResult(null);
  }, [marketKey(market), models.length]);

  const hasModel = !!(xgb || lstm);
  useEffect(() => {
    if (!hasModel && windowName === "model_test") setWindowName("test");
    if (hasModel && windowName === "test") setWindowName("model_test");
  }, [hasModel]);

  const specs = (): StrategySpec[] => {
    const out: StrategySpec[] = [];
    if (useBH) out.push({ name: "buy_hold", params: {} });
    if (useSMA) out.push({ name: "sma_crossover", params: { ...sma }, ...(tune ? { trials: tune.trials, trial_sharpe_std: tune.trial_sharpe_std } : {}) });
    if (xgb) out.push({ name: "xgboost", params: { model_id: xgb } });
    if (lstm) out.push({ name: "lstm", params: { model_id: lstm } });
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
      setSma({ fast: r.best.fast, slow: r.best.slow });
      toast(`SMA ${r.best.fast}/${r.best.slow} chosen on validation from ${r.trials} configurations. The trial count feeds the Deflated Sharpe.`, "ok");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  useEffect(() => {
    if (autorun.current && !modelsLoading) {
      autorun.current = false;
      setSearch({}, { replace: true });
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
                    <NumberInput value={sma.fast} min={2} step={1} onChange={(v) => { setSma({ ...sma, fast: v ?? 20 }); setTune(null); }} />
                  </Field>
                  <Field label="Slow">
                    <NumberInput value={sma.slow} min={3} step={1} onChange={(v) => { setSma({ ...sma, slow: v ?? 50 }); setTune(null); }} />
                  </Field>
                  <Button icon={<Wand2 className="size-3.5" />} loading={tuneMut.isPending} onClick={() => tuneMut.mutate()} title="Grid search on train/validation">
                    Tune
                  </Button>
                </div>
                {tune && <p className="text-[11px] text-muted">Tuned on validation (Sharpe {num(tune.best_val_sharpe)}), {tune.trials} trials counted for the DSR.</p>}
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
        <Button variant="primary" className="w-full" icon={<Play className="size-4" />} loading={run.isPending} disabled={count < 2} onClick={() => run.mutate()}>
          Run comparison
        </Button>
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
