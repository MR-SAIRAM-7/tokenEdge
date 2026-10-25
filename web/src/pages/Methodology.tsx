import type { ReactNode } from "react";
import { usePresets } from "../api/queries";
import { BookOpen } from "lucide-react";
import { Card, CardHeader, PageHeader } from "../components/ui";

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={`${n}. ${title}`} />
      <div className="space-y-3 px-4 pb-5 text-sm leading-relaxed text-fg-2">{children}</div>
    </Card>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg bg-panel-2 px-3 py-2 font-mono text-[13px] whitespace-nowrap text-fg">{children}</div>;
}

function TimingDiagram() {
  const bars = [
    { x: 60, o: 70, c: 52, h: 44, l: 78, label: "bar t−1" },
    { x: 220, o: 56, c: 40, h: 32, l: 64, label: "bar t" },
    { x: 380, o: 42, c: 30, h: 22, l: 50, label: "bar t+1" },
  ];
  return (
    <svg viewBox="0 0 520 150" className="w-full max-w-xl" role="img" aria-label="A signal computed at the close of bar t is filled at the open of bar t+1">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
        </marker>
      </defs>
      {bars.map((b) => (
        <g key={b.label}>
          <line x1={b.x} x2={b.x} y1={b.h} y2={b.l} stroke="var(--muted)" strokeWidth="2" />
          <rect x={b.x - 14} y={Math.min(b.o, b.c)} width="28" height={Math.abs(b.o - b.c)} rx="3" fill="var(--panel-2)" stroke="var(--muted)" strokeWidth="1.5" />
          <text x={b.x} y="100" textAnchor="middle" fontSize="12" fill="var(--fg-2)">
            {b.label}
          </text>
        </g>
      ))}
      <circle cx="234" cy="40" r="5" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
      <text x="234" y="20" textAnchor="middle" fontSize="11" fill="var(--fg)">
        close: signal computed
      </text>
      <circle cx="366" cy="42" r="5" fill="#d95926" stroke="var(--panel)" strokeWidth="2" />
      <path d="M244 44 C 290 70, 320 70, 358 46" fill="none" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#arrow)" />
      <text x="366" y="125" textAnchor="middle" fontSize="11" fill="var(--fg)">
        open: order filled (+ slippage, fees)
      </text>
      <line x1="366" x2="366" y1="52" y2="112" stroke="var(--line)" strokeWidth="1" />
    </svg>
  );
}

function SplitDiagram() {
  const segs = [
    { x: 0, w: 250, label: "TRAIN", fill: "var(--accent)", text: "#fff" },
    { x: 252, w: 22, label: "P", fill: "var(--neg)", text: "#fff" },
    { x: 276, w: 22, label: "E", fill: "var(--warn)", text: "#000" },
    { x: 300, w: 120, label: "VALIDATION", fill: "color-mix(in srgb, var(--accent) 45%, transparent)", text: "var(--fg)" },
    { x: 422, w: 22, label: "P", fill: "var(--neg)", text: "#fff" },
    { x: 446, w: 22, label: "E", fill: "var(--warn)", text: "#000" },
    { x: 470, w: 150, label: "TEST (locked)", fill: "color-mix(in srgb, var(--pos) 70%, transparent)", text: "#fff" },
  ];
  return (
    <svg viewBox="0 0 620 70" className="w-full" role="img" aria-label="Train, then purge and embargo, then validation, then purge and embargo, then test">
      {segs.map((s, i) => (
        <g key={i}>
          <rect x={s.x} y="8" width={s.w} height="32" rx="4" fill={s.fill} />
          <text x={s.x + s.w / 2} y="29" textAnchor="middle" fontSize="12" fontWeight="600" fill={s.text}>
            {s.label}
          </text>
        </g>
      ))}
      <text x="0" y="60" fontSize="11" fill="var(--muted)">
        time →
      </text>
      <text x="620" y="60" textAnchor="end" fontSize="11" fill="var(--muted)">
        P = purge (label horizon crosses the boundary) · E = embargo bars
      </text>
    </svg>
  );
}

function BarrierDiagram() {
  const path = "M20,80 L60,72 L90,84 L120,60 L150,66 L180,44 L200,38";
  return (
    <svg viewBox="0 0 320 130" className="w-full max-w-sm" role="img" aria-label="Triple barrier: the price path touches the upper barrier before the time limit">
      <line x1="20" x2="280" y1="38" y2="38" stroke="var(--pos)" strokeWidth="2" />
      <line x1="20" x2="280" y1="112" y2="112" stroke="var(--neg)" strokeWidth="2" />
      <line x1="280" x2="280" y1="30" y2="120" stroke="var(--muted)" strokeWidth="2" />
      <text x="284" y="42" fontSize="10" fill="var(--fg-2)">
        +k·σ
      </text>
      <text x="284" y="116" fontSize="10" fill="var(--fg-2)">
        −k·σ
      </text>
      <text x="252" y="128" fontSize="10" fill="var(--fg-2)">
        t + h
      </text>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="20" cy="80" r="4" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
      <circle cx="200" cy="38" r="5" fill="var(--pos)" stroke="var(--panel)" strokeWidth="2" />
      <text x="200" y="26" textAnchor="middle" fontSize="10" fill="var(--fg)">
        label = 1, t₁ here
      </text>
      <text x="20" y="98" fontSize="10" fill="var(--fg-2)">
        t
      </text>
    </svg>
  );
}

export default function Methodology() {
  const { data: presets } = usePresets();
  return (
    <div className="space-y-4">
      <PageHeader
        icon={<BookOpen className="size-5" />}
        eyebrow="Learn"
        title="Methodology"
        subtitle="How TokenEdge keeps the comparison honest. The design follows López de Prado, Advances in Financial Machine Learning (2018), chapters 3, 7, 11, 12 and 14."
      />

      <div data-tour="methodology" className="space-y-4">
      <Section n={1} title="Next-bar execution">
        <p>
          A strategy's decision for bar <i>t</i> may use every price up to and including the close of bar <i>t</i>. The engine fills that decision at the <b>open of bar t+1</b>,
          moved against the trader by the slippage model, and charges commission. Trading at the same close that produced the signal is impossible by construction, and a unit
          test checks every fill timestamp is later than its signal.
        </p>
        <TimingDiagram />
        <p>Positions change only when the target changes, so equity drift never causes small rebalancing trades. Any open position is closed at the last bar's close, with costs.</p>
      </Section>
      </div>

      <Section n={2} title="Chronological splits, purging and embargo">
        <p>
          Data is split in time order, never shuffled. Each sample's label is resolved at a future time t₁. A training sample whose t₁ falls on or after the start of the next
          split is <b>purged</b>, because its outcome overlaps the period it will be judged on. An extra <b>embargo</b> of a few bars guards against leakage through serially
          correlated features. Hyperparameters are searched with <b>purged K-fold cross-validation</b> inside the training set.
        </p>
        <SplitDiagram />
        <div className="overflow-x-auto">
          <table className="w-full max-w-2xl text-xs">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-1.5 font-medium">Activity</th>
                <th className="py-1.5 text-center font-medium">Train</th>
                <th className="py-1.5 text-center font-medium">Validation</th>
                <th className="py-1.5 text-center font-medium">Test</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Fit model, scaler, CV search", "✓", "—", "—"],
                ["Early stopping, trading threshold", "—", "✓", "—"],
                ["Choose SMA windows (grid search)", "✓", "✓", "—"],
                ["Final strategy comparison", "—", "—", "✓"],
              ].map((r) => (
                <tr key={r[0]} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 text-fg-2">{r[0]}</td>
                  {r.slice(1).map((c, i) => (
                    <td key={i} className={`py-1.5 text-center ${c === "✓" ? "text-pos" : "text-muted"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={3} title="Causal features and the leakage tests">
        <p>
          Every indicator uses right-aligned rolling windows or recursive averages, so the value at bar <i>t</i> depends only on bars ≤ <i>t</i>. This is tested, not assumed:
          the <b>future-perturbation test</b> computes features and signals on data up to <i>t</i>, appends random future bars, recomputes, and requires the values up to{" "}
          <i>t</i> to be identical. It runs for every feature and every strategy, including the ML models, the probability-sized positions and the SMA + ML filter.
          The fractionally differentiated price (feature set v2) applies a fixed window of weights to past log prices only, so it passes the same test.
        </p>
        <p>
          The LSTM's feature scaler is fitted on training rows only. The training notebooks cut the data off at the end of the validation window before building anything, so
          the test period is structurally invisible during training.
        </p>
      </Section>

      <Section n={4} title="Labels">
        <div className="grid items-center gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <p>
              <b>Fixed horizon:</b> label 1 if the close <i>h</i> bars ahead is higher than today's close by more than a threshold τ.
            </p>
            <p>
              <b>Triple barrier:</b> place a profit-taking barrier at +k·σ, a stop-loss at −k·σ (σ = recent volatility, known at <i>t</i>) and a time limit <i>h</i> bars
              ahead. The label records which is touched first. Labels adapt to volatility and match how a trade would actually exit.
            </p>
          </div>
          <BarrierDiagram />
        </div>
      </Section>

      <Section n={5} title="The window guard and the test-set lock">
        <p>
          Each exported model records its train, validation and test windows. When a backtest uses a model, the API compares the requested start with the model's held-out start
          (after validation plus embargo). An overlap is refused with HTTP 409 unless "allow in-sample" is ticked, and then every chart is badged <b>In-sample</b>. Each look at
          the test window is counted on the model card: many looks turn the test set into a validation set.
        </p>
      </Section>

      <Section n={6} title="Transaction costs and slippage">
        <Formula>fee = max(min_fee, |qty| · price · bps / 10⁴) + fixed_fee    (separate buy and sell rates)</Formula>
        <Formula>fill = open · (1 ± s);  s = bps/10⁴  |  k · (H−L)/C of previous bar  |  half_spread + η · σ · √(qty / ADV₂₀)</Formula>
        {presets && (
          <div className="overflow-x-auto">
            <table className="w-full max-w-3xl text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-1.5 font-medium">Preset</th>
                  <th className="py-1.5 text-right font-medium">Buy bps</th>
                  <th className="py-1.5 text-right font-medium">Sell bps</th>
                  <th className="py-1.5 text-right font-medium">Slippage bps</th>
                  <th className="py-1.5 pl-4 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {presets.map((p) => (
                  <tr key={p.name} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 text-fg">{p.label}</td>
                    <td className="py-1.5 text-right text-fg-2">{p.commission.buy_bps}</td>
                    <td className="py-1.5 text-right text-fg-2">{p.commission.sell_bps}</td>
                    <td className="py-1.5 text-right text-fg-2">{p.slippage.bps}</td>
                    <td className="py-1.5 pl-4 text-muted">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section n={7} title="Statistics">
        <Formula>Sharpe = √N · mean(r − r_f/N) / std(r)        Max DD = minₜ ( Eₜ / maxₛ≤ₜ Eₛ − 1 )        Calmar = CAGR / |Max DD|</Formula>
        <p>
          <b>Probabilistic Sharpe Ratio</b>: the probability that the true Sharpe ratio is above zero, given the sample length, skewness and kurtosis of returns.{" "}
          <b>Deflated Sharpe Ratio</b>: the same probability measured against the Sharpe you would expect from the best of <i>K</i> skill-less trials, where <i>K</i> is the
          number of parameter combinations and thresholds actually tried.
        </p>
        <p>
          <b>Bootstrap test</b>: returns of two strategies are resampled together in random-length blocks (stationary bootstrap, which keeps autocorrelation) thousands of times.
          If the 95% interval of the Sharpe difference includes zero, the "winner" may be luck.
        </p>
      </Section>

      <Section n={8} title="Known limitations">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Survivorship bias:</b> Yahoo Finance only lists companies that exist today, so single-stock results skip firms that failed.
          </li>
          <li>
            <b>Adjusted prices:</b> equity prices are split- and dividend-adjusted, which is right for returns but means historical prices differ from what was quoted at the time.
          </li>
          <li>
            <b>Liquidity:</b> fills assume the trade size can be executed at the open with the modelled slippage. That holds for liquid ETFs, large caps and major crypto pairs,
            not for small caps.
          </li>
          <li>
            <b>One asset at a time:</b> no portfolio construction or cross-asset signals.
          </li>
          <li>
            <b>Interest on cash:</b> idle cash earns the risk-free rate (4% a year by default, the same rate the Sharpe ratio subtracts), so a strategy that stays flat has a
            Sharpe of about zero. Real cash yields vary by broker and market, and crypto stablecoins may earn nothing.
          </li>
          <li>
            <b>Regimes change:</b> a held-out period is still one historical path. Treat results as evidence, not a forecast.
          </li>
        </ul>
      </Section>
    </div>
  );
}
