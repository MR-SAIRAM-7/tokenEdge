import { ArrowLeft, FlaskConical, GitCompareArrows } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { useModel } from "../api/queries";
import { DiagnosticsCard } from "../components/BacktestResults";
import { HBarChart } from "../components/charts/Bars";
import { SplitTimeline } from "../components/charts/Grids";
import { XYChart } from "../components/charts/XYChart";
import { Alert, Badge, Button, Card, CardHeader, PageHeader, Skeleton } from "../components/ui";
import { strategyColor } from "../lib/colors";
import { dateTimeLocal, num, pct } from "../lib/format";
import { useMarket } from "../state/market";
import { useTheme } from "../state/theme";

export default function ModelDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const market = useMarket();
  const { mode } = useTheme();
  const { data: m, isLoading, error } = useModel(id);

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !m) return <Alert tone="error" title="Model not found">{(error as Error)?.message}</Alert>;

  const color = strategyColor(m.model_type, mode);
  const val = m.metrics.val;
  const importance = Object.entries(m.feature_importance ?? {}).slice(0, 15);
  const history = m.history ?? {};
  const lossKeys = m.model_type === "lstm" ? ["train_loss", "val_loss"] : ["logloss"];
  const historySeries = lossKeys
    .filter((k) => history[k]?.length)
    .map((k, i) => ({
      key: k,
      label: k === "logloss" ? "Validation log-loss" : k === "train_loss" ? "Train loss" : "Validation loss",
      color: i === 0 ? color : strategyColor("sma_crossover", mode),
      points: history[k].map((y, x) => ({ x: x + 1, y })),
    }));

  const openWith = (path: string) => {
    market.setMarket({ symbol: m.symbol, source: m.source, interval: m.interval });
    navigate(path);
  };

  return (
    <div className="space-y-4">
      <Link to="/models" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All models
      </Link>
      <PageHeader
        title={<span className="font-mono">{m.model_id}</span>}
        subtitle={`${m.model_type === "xgboost" ? "XGBoost" : "LSTM"} · ${m.symbol} · ${m.interval} · trained ${dateTimeLocal(m.created_at)}${m.training_seconds ? ` in ${Math.round(m.training_seconds)} s` : ""}`}
        actions={
          <>
            <Button icon={<FlaskConical className="size-4" />} onClick={() => openWith(`/backtest?strategy=${m.model_type}&model=${encodeURIComponent(m.model_id)}`)}>
              Backtest
            </Button>
            <Button variant="primary" icon={<GitCompareArrows className="size-4" />} onClick={() => openWith("/compare")}>
              Compare
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader title="Data splits" subtitle="Backtests that start before the held-out window are blocked by default." />
        <div className="px-4 pb-4">
          <SplitTimeline splits={m.splits} dataRange={m.data_range} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Configuration" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 px-4 pb-4 text-sm">
            <dt className="text-muted">Label</dt>
            <dd className="text-fg">
              {m.label.method.replace("_", " ")}
              {Object.entries(m.label)
                .filter(([k]) => k !== "method")
                .map(([k, v]) => ` · ${k}=${Array.isArray(v) ? v.join("/") : String(v)}`)}
            </dd>
            <dt className="text-muted">Features</dt>
            <dd className="text-fg">
              {m.features.length} ({m.feature_set}){m.seq_len ? ` · sequence length ${m.seq_len}` : ""}
            </dd>
            <dt className="text-muted">Threshold</dt>
            <dd className="text-fg">
              long above {num(m.threshold.long, 2)} · short below {num(m.threshold.short, 2)}
            </dd>
            <dt className="text-muted">Cost preset</dt>
            <dd className="text-fg">{m.cost_preset ?? "—"}</dd>
            <dt className="text-muted">Search</dt>
            <dd className="text-fg">
              {String(m.cv.method ?? "—").replace("_", " ")} · {m.cv.trials ?? 1} trials counted for DSR
            </dd>
            <dt className="text-muted">Test evaluations</dt>
            <dd className="text-fg">
              {m.test_evaluations}{" "}
              {m.test_evaluations > 5 && <Badge tone="warn">many looks at the test set inflate results</Badge>}
            </dd>
            <dt className="text-muted">Data hash</dt>
            <dd className="truncate font-mono text-[11px] text-fg-2" title={m.data_hash}>
              {m.data_hash}
            </dd>
            {m.onnx_parity_max_abs_diff != null && (
              <>
                <dt className="text-muted">ONNX parity</dt>
                <dd className="text-fg">max |PyTorch − ONNX| = {m.onnx_parity_max_abs_diff.toExponential(1)}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-1.5 px-4 pb-4">
            {Object.entries(m.hyperparameters).map(([k, v]) => (
              <Badge key={k} tone="neutral">
                {k}: {typeof v === "number" ? num(v, Number.isInteger(v) ? 0 : 3) : String(v)}
              </Badge>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Validation results" subtitle={val?.sharpe_after_costs != null ? `Sharpe after costs at the chosen threshold: ${num(val.sharpe_after_costs)}` : undefined} />
          <div className="px-4 pb-4">{val ? <DiagnosticsCard report={val} title="Validation window" /> : <p className="text-sm text-muted">No validation metrics stored.</p>}</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {m.threshold_search && m.threshold_search.length > 0 && (
          <Card>
            <CardHeader title="Threshold search (validation)" subtitle="Each candidate threshold backtested on the validation window after costs." />
            <div className="px-4 pb-4">
              <XYChart
                series={[{ key: "sharpe", label: "Validation Sharpe", color, dots: true, points: m.threshold_search.map((r) => ({ x: r.threshold, y: r.sharpe })) }]}
                xLabel="P(up) threshold"
                xFormat={(v) => num(v, 2)}
                yFormat={(v) => num(v, 2)}
                refX={{ x: m.threshold.long, label: "chosen" }}
                refY={0}
              />
            </div>
          </Card>
        )}
        {historySeries.length > 0 && (
          <Card>
            <CardHeader title="Training curve" subtitle={m.model_type === "lstm" ? "Loss per epoch; the best validation epoch was kept." : "Validation log-loss per boosting round; trees after the best round were dropped."} />
            <div className="px-4 pb-4">
              <XYChart series={historySeries} xLabel={m.model_type === "lstm" ? "Epoch" : "Boosting round"} xFormat={(v) => String(v)} yFormat={(v) => num(v, 3)} />
            </div>
          </Card>
        )}
        {val?.roc_curve && (
          <Card>
            <CardHeader title="ROC curve (validation)" subtitle={`AUC ${num(val.roc_auc, 3)}. The diagonal is a coin flip.`} />
            <div className="px-4 pb-4">
              <XYChart
                series={[{ key: "roc", label: "ROC", color, points: val.roc_curve.map((p) => ({ x: p.fpr, y: p.tpr })) }]}
                xLabel="False positive rate"
                xFormat={(v) => pct(v, 0)}
                yFormat={(v) => pct(v, 0)}
                diagonal
                xDomain={[0, 1]}
                yDomain={[0, 1]}
              />
            </div>
          </Card>
        )}
        {importance.length > 0 && (
          <Card>
            <CardHeader title="Feature importance (gain)" subtitle="Share of total split gain, top 15 features." />
            <div className="px-4 pb-4">
              <HBarChart items={importance.map(([k, v]) => ({ label: k, value: v, color }))} format={(v) => pct(v, 1)} rowHeight={24} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
