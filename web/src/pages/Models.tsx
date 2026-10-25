import { BrainCircuit, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { useModels } from "../api/queries";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from "../components/ui";
import { date, num, pct } from "../lib/format";

const REPO = "MR-SAIRAM-7/tokenEdge";
const colab = (nb: string) => `https://colab.research.google.com/github/${REPO}/blob/main/notebooks/${nb}`;

export function TrainingGuide() {
  return (
    <Card>
      <CardHeader title="Train models in Google Colab" subtitle="No training happens on your laptop or inside the web app. Colab gives a free GPU; the app only loads the exported files." />
      <div className="grid grid-cols-1 gap-4 px-4 pb-4 md:grid-cols-2">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-fg-2">
          <li>
            Open a notebook in Colab:{" "}
            <a className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline" href={colab("01_train_xgboost.ipynb")} target="_blank" rel="noreferrer">
              XGBoost <ExternalLink className="size-3" />
            </a>{" "}
            ·{" "}
            <a className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline" href={colab("02_train_lstm.ipynb")} target="_blank" rel="noreferrer">
              LSTM <ExternalLink className="size-3" />
            </a>
          </li>
          <li>For the LSTM, choose Runtime → Change runtime type → GPU.</li>
          <li>Set the symbol and interval in the config cell, then Runtime → Run all.</li>
          <li>
            The last cell downloads <code className="rounded bg-panel-2 px-1">&lt;model_id&gt;.zip</code>. Unzip it into the project's <code className="rounded bg-panel-2 px-1">models/</code> folder.
          </li>
          <li>Refresh this page. The model appears automatically, and the Backtest and Compare pages can use it.</li>
        </ol>
        <div className="space-y-2 rounded-lg bg-panel-2 p-3 text-xs text-fg-2">
          <div className="font-medium text-fg">What the notebooks guarantee</div>
          <ul className="list-disc space-y-1 pl-4">
            <li>Data after the validation window is cut off before features are built, so the test period is never seen.</li>
            <li>Purged K-fold CV (XGBoost) and early stopping on validation; the scaler (LSTM) is fit on training rows only.</li>
            <li>The trading threshold is picked on validation by Sharpe after costs, not by accuracy.</li>
            <li>Each model stores its splits, features, label settings and data hash in metadata.json. The app uses that to block in-sample backtests.</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

export default function Models() {
  const { data: models, isLoading, error } = useModels();
  return (
    <div className="space-y-4">
      <PageHeader
        icon={<BrainCircuit className="size-5" />}
        eyebrow="Data & models"
        title="Models"
        subtitle="Registered XGBoost and LSTM models found in the models/ folder, with their training windows and validation results. Click a model for its full report."
      />
      {isLoading && <Skeleton className="h-40" />}
      {error && <EmptyState title="Could not load models">{(error as Error).message}</EmptyState>}
      {models && models.length === 0 && (
        <Card>
          <EmptyState icon={<BrainCircuit className="size-8" />} title="No trained models yet">
            Follow the steps below. The SMA baseline and Buy &amp; Hold work without any model.
          </EmptyState>
        </Card>
      )}
      {models && models.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-tour="models">
          {models.map((m) => (
            <Link key={m.model_id} to={`/models/${encodeURIComponent(m.model_id)}`}>
              <Card className="h-full p-4 transition-colors hover:border-muted/60">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-medium text-fg">{m.model_id}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {m.symbol} · {m.interval} · {m.label_method?.replace("_", " ")}
                    </div>
                  </div>
                  <Badge tone="accent">{m.model_type === "xgboost" ? "XGBoost" : "LSTM"}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-panel-2 py-2">
                    <dd className="tabular text-sm font-semibold text-fg">{num(m.val_metrics.roc_auc, 3)}</dd>
                    <dt className="text-muted">Val AUC</dt>
                  </div>
                  <div className="rounded-lg bg-panel-2 py-2">
                    <dd className="tabular text-sm font-semibold text-fg">{pct(m.val_metrics.accuracy, 1)}</dd>
                    <dt className="text-muted">Val accuracy</dt>
                  </div>
                  <div className="rounded-lg bg-panel-2 py-2">
                    <dd className="tabular text-sm font-semibold text-fg">{num(m.val_metrics.sharpe_after_costs, 2)}</dd>
                    <dt className="text-muted">Val Sharpe</dt>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  <Badge tone="neutral">held-out from {date(m.splits?.test?.[0])}</Badge>
                  <Badge tone="neutral">threshold {num(m.threshold?.long, 2)}</Badge>
                  {m.training_env && <Badge tone="neutral">{m.training_env.replace(" (CPU runner)", "")}</Badge>}
                  <Badge tone={m.test_evaluations > 5 ? "warn" : "neutral"} title="How many times this model has been evaluated on its test window">
                    test evals: {m.test_evaluations}
                  </Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <TrainingGuide />
    </div>
  );
}
