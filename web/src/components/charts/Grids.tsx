import type { ClassificationReport, ModelSplits, MonthlyReturn, TuneResult } from "../../api/types";
import { divergingColor, textOn } from "../../lib/colors";
import { date, int, num, pct } from "../../lib/format";
import { useTheme } from "../../state/theme";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MonthlyHeatmap({ data }: { data: MonthlyReturn[] }) {
  const { mode } = useTheme();
  const years = Array.from(new Set(data.map((d) => d.year))).sort();
  const byKey = new Map(data.map((d) => [`${d.year}-${d.month}`, d.return]));
  const maxAbs = Math.max(0.01, ...data.map((d) => Math.abs(d.return ?? 0)));
  const yearTotal = (y: number) => {
    const rs = data.filter((d) => d.year === y && d.return != null).map((d) => d.return as number);
    return rs.length ? rs.reduce((acc, r) => acc * (1 + r), 1) - 1 : null;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-[2px] text-[11px]">
        <thead>
          <tr className="text-muted">
            <th className="w-12 text-left font-medium" />
            {MONTHS.map((m) => (
              <th key={m} className="font-medium">
                {m}
              </th>
            ))}
            <th className="font-medium">Year</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {years.map((y) => (
            <tr key={y}>
              <td className="pr-1 font-medium text-fg-2">{y}</td>
              {MONTHS.map((_, i) => {
                const r = byKey.get(`${y}-${i + 1}`);
                if (r === undefined) return <td key={i} />;
                const bg = divergingColor(r, maxAbs, mode);
                return (
                  <td key={i} className="h-7 rounded text-center" style={{ background: bg, color: textOn(bg) }} title={`${MONTHS[i]} ${y}: ${pct(r, 2, true)}`}>
                    {pct(r, 1)}
                  </td>
                );
              })}
              {(() => {
                const total = yearTotal(y);
                const bg = divergingColor(total, maxAbs * 3, mode);
                return (
                  <td className="h-7 rounded text-center font-semibold" style={{ background: bg, color: textOn(bg) }} title={`${y}: ${pct(total, 2, true)}`}>
                    {pct(total, 1)}
                  </td>
                );
              })()}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConfusionMatrix({ report }: { report: ClassificationReport }) {
  const [[tn, fp], [fn, tp]] = report.confusion_matrix;
  const total = Math.max(1, tn + fp + fn + tp);
  const cells = [
    { label: "True negative", v: tn, good: true },
    { label: "False positive", v: fp, good: false },
    { label: "False negative", v: fn, good: false },
    { label: "True positive", v: tp, good: true },
  ];
  return (
    <div className="inline-grid grid-cols-[auto_1fr_1fr] gap-[2px] text-xs">
      <div />
      <div className="px-2 pb-1 text-center text-muted">Pred. down</div>
      <div className="px-2 pb-1 text-center text-muted">Pred. up</div>
      {[0, 1].map((row) => (
        <div key={row} className="contents">
          <div className="flex items-center pr-2 text-muted">{row === 0 ? "Actual down" : "Actual up"}</div>
          {cells.slice(row * 2, row * 2 + 2).map((cell) => (
            <div
              key={cell.label}
              className="flex min-w-24 flex-col items-center justify-center rounded px-3 py-2.5"
              style={{ background: cell.good ? "var(--accent-soft)" : "var(--panel-2)" }}
              title={cell.label}
            >
              <span className="tabular text-base font-semibold text-fg">{int(cell.v)}</span>
              <span className="text-[10.5px] text-muted">{pct(cell.v / total, 0)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SmaGridHeatmap({ result, selected }: { result: TuneResult; selected?: { fast: number; slow: number } }) {
  const { mode } = useTheme();
  const fasts = Array.from(new Set(result.grid.map((g) => g.fast))).sort((a, b) => a - b);
  const slows = Array.from(new Set(result.grid.map((g) => g.slow))).sort((a, b) => a - b);
  const maxAbs = Math.max(0.1, ...result.grid.map((g) => Math.abs(g.val_sharpe ?? 0)));
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-[11px]">
        <thead>
          <tr className="text-muted">
            <th className="pr-2 text-right font-medium">fast \ slow</th>
            {slows.map((s) => (
              <th key={s} className="w-14 font-medium">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {fasts.map((f) => (
            <tr key={f}>
              <td className="pr-2 text-right text-muted">{f}</td>
              {slows.map((s) => {
                const g = result.grid.find((x) => x.fast === f && x.slow === s);
                if (!g) return <td key={s} />;
                const bg = divergingColor(g.val_sharpe, maxAbs, mode);
                const isBest = result.best.fast === f && result.best.slow === s;
                const isSel = selected?.fast === f && selected?.slow === s;
                return (
                  <td
                    key={s}
                    className="h-7 rounded text-center"
                    style={{ background: bg, color: textOn(bg), outline: isBest || isSel ? "2px solid var(--fg)" : undefined, outlineOffset: -2 }}
                    title={`SMA ${f}/${s}: validation Sharpe ${num(g.val_sharpe)}, train Sharpe ${num(g.train_sharpe)}, ${g.val_trades} trades`}
                  >
                    {num(g.val_sharpe, 2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SplitTimeline({ splits, dataRange }: { splits: ModelSplits; dataRange?: [string, string] }) {
  const t = (s: string | null | undefined) => (s ? new Date(s).getTime() : Date.now());
  const start = t(splits.train[0]);
  const end = Math.max(t(splits.test[1] ?? null), t(dataRange?.[1]));
  const span = Math.max(1, end - start);
  const x = (s: string | null | undefined) => ((t(s) - start) / span) * 100;
  const parts = [
    { name: "Train", from: splits.train[0], to: splits.train[1], used: splits.train_used, cls: "bg-accent", note: "fit model, scaler, CV search" },
    { name: "Validation", from: splits.val[0], to: splits.val[1], used: splits.val_used, cls: "bg-accent/45", note: "early stopping, threshold" },
    { name: "Test (held-out)", from: splits.test[0], to: splits.test[1], used: null, cls: "bg-pos/70", note: "final comparison only" },
  ];
  return (
    <div>
      <div className="relative h-9 overflow-hidden rounded-lg bg-panel-2">
        {parts.map((p) => (
          <div
            key={p.name}
            className={`absolute inset-y-0 ${p.cls}`}
            style={{ left: `${x(p.from)}%`, width: `calc(${Math.max(0.5, x(p.to) - x(p.from))}% - 2px)` }}
            title={`${p.name}: ${date(p.from)} → ${p.to ? date(p.to) : "latest"}`}
          />
        ))}
        {parts.slice(0, 2).map((p) =>
          p.used ? (
            <div
              key={`gap-${p.name}`}
              className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,var(--neg)_0,var(--neg)_2px,transparent_2px,transparent_5px)] opacity-80"
              style={{ left: `${x(p.used[1])}%`, width: `${Math.max(0.4, x(p.to) - x(p.used[1]))}%` }}
              title={`Purge + embargo: samples after ${date(p.used[1])} dropped`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
        {parts.map((p) => (
          <div key={p.name}>
            <div className="flex items-center gap-1.5 font-medium text-fg">
              <span className={`size-2.5 rounded-sm ${p.cls}`} />
              {p.name}
            </div>
            <div className="tabular text-fg-2">
              {date(p.from)} → {p.to ? date(p.to) : "latest"}
            </div>
            {p.used && <div className="text-muted">{int(p.used[2])} samples used, last {date(p.used[1])}</div>}
            <div className="text-muted">{p.note}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
        <span className="inline-block h-2.5 w-4 rounded-sm bg-[repeating-linear-gradient(45deg,var(--neg)_0,var(--neg)_2px,transparent_2px,transparent_5px)]" />
        Purged + embargoed samples ({splits.embargo_bars} embargo bars after the label horizon)
      </div>
    </div>
  );
}
