import { ArrowRight, CheckCircle2, ExternalLink, GraduationCap, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Alert, Card, CardHeader } from "../components/ui";
import { ABSTRACT, PROJECT } from "../config/project";

const OBJECTIVES = [
  {
    title: "Backtesting engine with realistic costs",
    text: "Event-driven engine with next-bar-open execution, commission presets for US, NSE and crypto markets, and fixed, range-based or square-root-impact slippage. Verified against Backtrader.",
    to: "/backtest",
    cta: "Backtest Lab",
  },
  {
    title: "Classical technical-indicator baseline",
    text: "Moving-average crossover (SMA or EMA) whose windows are tuned on train and validation data only, with the number of trials recorded for the Deflated Sharpe Ratio.",
    to: "/backtest",
    cta: "Try the SMA baseline",
  },
  {
    title: "ML price-movement predictor",
    text: "XGBoost and LSTM classifiers predict short-horizon direction from technical features, with triple-barrier labels, purged cross-validation and a threshold chosen by validation Sharpe after costs.",
    to: "/models",
    cta: "See the models",
  },
  {
    title: "Risk-adjusted comparison on held-out data",
    text: "Sharpe, Sortino, max drawdown, Calmar, Probabilistic and Deflated Sharpe, a block-bootstrap significance test and cost sensitivity, all on the models' held-out window.",
    to: "/findings",
    cta: "View the findings",
  },
];

const STACK: { group: string; items: string[] }[] = [
  { group: "Core", items: ["Python 3.11+", "pandas", "NumPy", "SciPy"] },
  { group: "Market data", items: ["yfinance", "ccxt", "Parquet cache"] },
  { group: "Machine learning", items: ["XGBoost", "PyTorch (training)", "ONNX Runtime (inference)"] },
  { group: "Backend", items: ["FastAPI", "Pydantic", "SQLAlchemy + SQLite"] },
  { group: "Frontend", items: ["React 19", "TypeScript", "Vite", "Tailwind CSS", "Lightweight Charts", "Recharts"] },
  { group: "Quality & delivery", items: ["pytest + Hypothesis", "Backtrader parity tests", "GitHub Actions", "Docker", "Render"] },
];

function Box({ x, y, w, h, title, sub, accent }: { x: number; y: number; w: number; h: number; title: string; sub: string; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={accent ? "var(--accent-soft)" : "var(--panel-2)"} stroke={accent ? "var(--accent)" : "var(--line)"} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--fg)">
        {title}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize={10.5} fill="var(--muted)">
        {sub}
      </text>
    </g>
  );
}

function Arrow({ d }: { d: string }) {
  return <path d={d} fill="none" stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#arch-arrow)" />;
}

function Architecture() {
  return (
    <svg viewBox="0 0 960 330" className="w-full min-w-[720px]" role="img" aria-label="System architecture diagram">
      <defs>
        <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
        </marker>
      </defs>
      <text x={12} y={18} fontSize={11} fontWeight={600} fill="var(--muted)">
        DATA SOURCES
      </text>
      <Box x={12} y={30} w={150} h={52} title="Yahoo Finance" sub="equities · yfinance" />
      <Box x={12} y={96} w={150} h={52} title="Crypto exchanges" sub="OHLCV · ccxt" />

      <text x={210} y={18} fontSize={11} fontWeight={600} fill="var(--muted)">
        TOKENEDGE LIBRARY
      </text>
      <Box x={210} y={62} w={150} h={52} title="Data layer" sub="cache · snapshots · QC" />
      <Box x={390} y={62} w={150} h={52} title="Features & labels" sub="indicators · triple barrier" />
      <Box x={570} y={62} w={150} h={52} title="Strategies" sub="SMA · XGBoost · LSTM" accent />
      <Box x={750} y={62} w={196} h={52} title="Backtest engine" sub="next-bar fills · costs · slippage" accent />
      <Box x={750} y={150} w={196} h={52} title="Metrics & statistics" sub="Sharpe · PSR/DSR · bootstrap" />
      <Box x={570} y={150} w={150} h={52} title="Leakage guards" sub="purge · embargo · window lock" />

      <Arrow d="M162,56 C186,56 186,82 208,84" />
      <Arrow d="M162,122 C186,122 186,94 208,92" />
      <Arrow d="M360,88 L388,88" />
      <Arrow d="M540,88 L568,88" />
      <Arrow d="M720,88 L748,88" />
      <Arrow d="M848,114 L848,148" />

      <text x={12} y={238} fontSize={11} fontWeight={600} fill="var(--muted)">
        TRAINING (CLOUD / COLAB)
      </text>
      <Box x={12} y={250} w={170} h={56} title="Colab notebooks" sub="purged CV · ONNX export" />
      <Box x={212} y={250} w={170} h={56} title="Model registry" sub="model.json · model.onnx" />
      <Arrow d="M182,278 L210,278" />
      <Arrow d="M297,250 C297,200 600,200 632,118" />

      <text x={430} y={238} fontSize={11} fontWeight={600} fill="var(--muted)">
        APPLICATION
      </text>
      <Box x={430} y={250} w={170} h={56} title="FastAPI REST API" sub="runs saved in SQLite" />
      <Box x={640} y={250} w={170} h={56} title="React web UI" sub="charts · reports · export" accent />
      <Arrow d="M848,202 C848,226 540,224 520,248" />
      <Arrow d="M600,278 L638,278" />
    </svg>
  );
}

function Section({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon}{title}</span>} />
      <div className="px-4 pb-5">{children}</div>
    </Card>
  );
}

export default function Project() {
  const teamFilled = PROJECT.team.length > 0 && PROJECT.guide.name;
  return (
    <div className="space-y-5">
      <Card className="hero-bg overflow-hidden">
        <div className="p-6 md:p-8">
          <div className="text-[11px] font-semibold tracking-wider text-accent uppercase">{PROJECT.course}</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg md:text-4xl">{PROJECT.name}</h1>
          <p className="mt-1 text-lg text-fg-2">{PROJECT.title}</p>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-fg-2">{ABSTRACT}</p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {PROJECT.college && <span>{PROJECT.college}</span>}
            <span>{PROJECT.department}</span>
            <span>Academic year {PROJECT.academicYear}</span>
            <a href={PROJECT.repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Source code <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section title="Objectives and what was delivered" icon={<CheckCircle2 className="size-4 text-pos" />}>
          <ol className="space-y-4">
            {OBJECTIVES.map((o, i) => (
              <li key={o.title} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{i + 1}</span>
                <div>
                  <div className="text-sm font-semibold text-fg">{o.title}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-fg-2">{o.text}</p>
                  <Link to={o.to} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                    {o.cta} <ArrowRight className="size-3" />
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </Section>
        <div className="space-y-5">
          <Section title="Team" icon={<Users className="size-4 text-accent" />}>
            {teamFilled ? (
              <div className="space-y-3 text-sm">
                <ul className="space-y-1.5">
                  {PROJECT.team.map((m) => (
                    <li key={m.name} className="flex justify-between gap-3">
                      <span className="font-medium text-fg">{m.name}</span>
                      {m.roll && <span className="tabular text-muted">{m.roll}</span>}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2 border-t border-line pt-3">
                  <GraduationCap className="size-4 text-muted" />
                  <span className="text-muted">Guide:</span>
                  <span className="font-medium text-fg">{PROJECT.guide.name}</span>
                  {PROJECT.guide.designation && <span className="text-muted">· {PROJECT.guide.designation}</span>}
                </div>
              </div>
            ) : (
              <Alert tone="warn" title="Add your team details">
                Fill in the team members, guide and college in <code className="rounded bg-panel-2 px-1">web/src/config/project.ts</code>, then rebuild the web app.
              </Alert>
            )}
          </Section>
          <Section title="Technology stack">
            <div className="space-y-3">
              {STACK.map((s) => (
                <div key={s.group}>
                  <div className="mb-1.5 text-xs font-medium text-muted">{s.group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.items.map((t) => (
                      <span key={t} className="rounded-md border border-line bg-panel-2 px-2 py-0.5 text-xs text-fg-2">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      <Section title="System architecture">
        <div className="overflow-x-auto">
          <Architecture />
        </div>
        <p className="mt-3 text-xs text-muted">
          Models are trained outside the app (Google Colab or a cloud CI runner) and exported as small files. The web app only runs inference, so the same feature code is used for training
          and prediction and no GPU is needed to run the app.
        </p>
      </Section>

      <Section title="References">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-fg-2">
          <li>López de Prado, M. (2018). Advances in Financial Machine Learning. Wiley. Chapters 3, 7, 11, 12, 14.</li>
          <li>Bailey, D. H., & López de Prado, M. (2014). The Deflated Sharpe Ratio. Journal of Portfolio Management, 40(5).</li>
          <li>Chen, T., & Guestrin, C. (2016). XGBoost: A Scalable Tree Boosting System. KDD '16.</li>
          <li>Hochreiter, S., & Schmidhuber, J. (1997). Long Short-Term Memory. Neural Computation, 9(8).</li>
          <li>Politis, D. N., & Romano, J. P. (1994). The Stationary Bootstrap. JASA, 89(428).</li>
        </ol>
      </Section>
    </div>
  );
}
