import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitCompareArrows, Play, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { useModels } from "../api/queries";
import type { CompareResponse, ExecutionIn, StrategySpec, TuneResult, WindowName } from "../api/types";
import { CompareResults } from "../components/CompareResults";
import { cleanExecution, DEFAULT_EXECUTION, ExecutionPanel, WindowPicker } from "../components/Forms";
import { useToast } from "../components/Toast";
import { Alert, Button, Card, CardHeader, Checkbox, EmptyState, Field, NumberInput, PageHeader, Select, Skeleton } from "../components/ui";
import { strategyColor } from "../lib/colors";
import { num } from "../lib/format";
import { marketKey, useMarket } from "../state/market";
import { useTheme } from "../state/theme";

export default function Compare() {
  const market = useMarket();
  const { mode } = useTheme();
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
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["models"] });
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

  // Dashboard "Compare" button: run once with defaults after models have loaded.
  useEffect(() => {
    if (autorun.current && !modelsLoading) {
      autorun.current = false;
      setSearch({}, { replace: true });
      setTimeout(() => run.mutate(), 0);
    }
  }, [modelsLoading]);

  const count = specs().length;
  const Swatch = ({ k }: { k: string }) => <span className="h-[3px] w-3.5 rounded-full" style={{ background: strategyColor(k, mode) }} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Compare strategies"
        subtitle="Classical baseline vs ML on the same held-out window, same costs. Includes Probabilistic/Deflated Sharpe, a block-bootstrap test and cost sensitivity."
      />
      <div className="grid items-start gap-4 xl:grid-cols-[360px_1fr]">
        <Card className="xl:sticky xl:top-20">
          <CardHeader title="Setup" subtitle={`${market.symbol} · ${market.interval}`} />
          <div className="space-y-4 px-4 pb-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Swatch k="buy_hold" />
                <Checkbox checked={useBH} onChange={setUseBH} label="Buy & Hold (benchmark)" />
              </div>

              <div className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <Swatch k="sma_crossover" />
                  <Checkbox checked={useSMA} onChange={setUseSMA} label="SMA crossover (baseline)" />
                </div>
                {useSMA && (
                  <>
                    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                      <Field label="Fast">
                        <NumberInput value={sma.fast} min={2} step={1} onChange={(v) => { setSma({ ...sma, fast: v ?? 20 }); setTune(null); }} />
                      </Field>
                      <Field label="Slow">
                        <NumberInput value={sma.slow} min={3} step={1} onChange={(v) => { setSma({ ...sma, slow: v ?? 50 }); setTune(null); }} />
                      </Field>
                      <Button size="md" icon={<Wand2 className="size-3.5" />} loading={tuneMut.isPending} onClick={() => tuneMut.mutate()} title="Grid search on train/validation">
                        Tune
                      </Button>
                    </div>
                    {tune && (
                      <p className="text-[11px] text-muted">
                        Tuned on validation (Sharpe {num(tune.best_val_sharpe)}), {tune.trials} trials counted for DSR.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex items-center gap-2 text-sm text-fg-2">
                  <Swatch k="xgboost" /> XGBoost model
                </div>
                <Select value={xgb} onChange={(e) => setXgb(e.target.value)} disabled={!xgbModels.length}>
                  <option value="">{xgbModels.length ? "Not included" : "No XGBoost models yet"}</option>
                  {xgbModels.map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.model_id} ({m.symbol})
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-2 pt-1 text-sm text-fg-2">
                  <Swatch k="lstm" /> LSTM model
                </div>
                <Select value={lstm} onChange={(e) => setLstm(e.target.value)} disabled={!lstmModels.length}>
                  <option value="">{lstmModels.length ? "Not included" : "No LSTM models yet"}</option>
                  {lstmModels.map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.model_id} ({m.symbol})
                    </option>
                  ))}
                </Select>
                {!models.length && !modelsLoading && (
                  <p className="text-[11px] text-muted">
                    Train models in Colab to add them. <Link className="text-accent hover:underline" to="/models">How →</Link>
                  </p>
                )}
              </div>
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

        <div className="min-w-0">
          {run.isPending && !result && <Skeleton className="h-[600px]" />}
          {result ? (
            <div className={run.isPending ? "pointer-events-none opacity-60" : ""}>
              <CompareResults run={result} />
            </div>
          ) : (
            !run.isPending && (
              <Card>
                <EmptyState icon={<GitCompareArrows className="size-8" />} title="Run a comparison">
                  With trained models selected, the window defaults to the models' held-out test period, the only fair place to compare. Without models, SMA and Buy &amp; Hold are
                  compared on the default test window.
                </EmptyState>
              </Card>
            )
          )}
        </div>
      </div>
    </div>
  );
}
