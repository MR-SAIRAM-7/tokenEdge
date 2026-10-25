import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Play, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { useModels, useStrategies } from "../api/queries";
import type { BacktestResponse, ExecutionIn, TuneResult, WindowName } from "../api/types";
import { BacktestResults } from "../components/BacktestResults";
import { SmaGridHeatmap } from "../components/charts/Grids";
import { cleanExecution, DEFAULT_EXECUTION, defaultParams, ExecutionPanel, StrategyParamsForm, WindowPicker } from "../components/Forms";
import { useToast } from "../components/Toast";
import { Alert, Button, Card, CardHeader, Checkbox, EmptyState, Field, PageHeader, Select, Skeleton } from "../components/ui";
import { num } from "../lib/format";
import { marketKey, useMarket } from "../state/market";

export default function BacktestLab() {
  const market = useMarket();
  const toast = useToast();
  const qc = useQueryClient();
  const [search] = useSearchParams();
  const { data: strategies } = useStrategies();
  const { data: models = [] } = useModels();

  const [name, setName] = useState(search.get("strategy") ?? "sma_crossover");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [windowName, setWindowName] = useState<WindowName>("test");
  const [dates, setDates] = useState({ start: "", end: "" });
  const [execution, setExecution] = useState<ExecutionIn>(DEFAULT_EXECUTION);
  const [allowInSample, setAllowInSample] = useState(false);
  const [tune, setTune] = useState<TuneResult | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);

  const strategy = strategies?.find((s) => s.name === name);
  const isML = strategy?.kind === "ml";

  // Reset parameters when the strategy, market or available models change.
  useEffect(() => {
    if (!strategy) return;
    const p = defaultParams(strategy, models, market.symbol, market.interval);
    const fromUrl = search.get("model");
    if (strategy.kind === "ml" && fromUrl && models.some((m) => m.model_id === fromUrl)) p.model_id = fromUrl;
    setParams(p);
    setWindowName(strategy.kind === "ml" ? "model_test" : "test");
    setTune(null);
  }, [strategy?.name, marketKey(market), models.length]);

  useEffect(() => setResult(null), [marketKey(market)]);

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
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

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
  const mlModels = useMemo(() => models.filter((m) => m.model_type === strategy?.model_type), [models, strategy]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Backtest Lab"
        subtitle="Run one strategy with realistic costs. Signals from bar t fill at the open of bar t+1; any open position is closed at the last bar of the window."
      />
      <div className="grid items-start gap-4 xl:grid-cols-[360px_1fr]">
        <Card className="xl:sticky xl:top-20">
          <CardHeader title="Configuration" subtitle={`${market.symbol} · ${market.interval}`} />
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
                    Train one in Colab first. <Link to="/models" className="font-medium text-accent hover:underline">How to train →</Link>
                  </Alert>
                )}

                {name === "sma_crossover" && (
                  <div className="space-y-2 rounded-lg border border-line p-3">
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
                  <WindowPicker
                    value={windowName}
                    onChange={setWindowName}
                    start={dates.start}
                    end={dates.end}
                    onDates={(start, end) => setDates({ start, end })}
                    hasModel={!!isML}
                  />
                </Field>

                <ExecutionPanel value={execution} onChange={setExecution} />

                {isML && (
                  <Checkbox
                    checked={allowInSample}
                    onChange={setAllowInSample}
                    label="Allow in-sample window"
                    help="By default the API refuses to backtest an ML model on bars it was trained or validated on. Turn this on only to demonstrate how optimistic in-sample results look."
                  />
                )}

                <Button
                  variant="primary"
                  className="w-full"
                  icon={<Play className="size-4" />}
                  loading={run.isPending}
                  disabled={missingModel}
                  onClick={() => run.mutate()}
                >
                  Run backtest
                </Button>
              </>
            )}
          </div>
        </Card>

        <div className="min-w-0">
          {run.isPending && !result && <Skeleton className="h-[520px]" />}
          {result ? (
            <div className={run.isPending ? "pointer-events-none opacity-60" : ""}>
              <BacktestResults run={result} />
            </div>
          ) : (
            !run.isPending && (
              <Card>
                <EmptyState icon={<FlaskConical className="size-8" />} title="Configure a strategy and press Run">
                  Results include the equity curve against Buy &amp; Hold, drawdowns, trade markers on the price chart, monthly returns and a full trade log. Every run is saved to Run History.
                </EmptyState>
              </Card>
            )
          )}
        </div>
      </div>
    </div>
  );
}
