import clsx from "clsx";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { useMemo, useState } from "react";
import type { Metrics, Trade } from "../api/types";
import { downloadCsv } from "../lib/download";
import { date, money, num, pct, price, signClass } from "../lib/format";
import { KPI_KEYS, METRIC_BY_KEY } from "../lib/metrics";
import { Button, InfoTip } from "./ui";

export function KpiTiles({ metrics, benchmark, keys = KPI_KEYS }: { metrics: Metrics; benchmark?: Metrics | null; keys?: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
      {keys.map((k) => {
        const def = METRIC_BY_KEY[k];
        const v = metrics[k] as number | null;
        const b = benchmark ? (benchmark[k] as number | null) : null;
        const signed = ["total_return", "cagr"].includes(k);
        return (
          <div key={k} className="rounded-xl border border-line bg-panel px-3 py-2.5">
            <div className="flex items-center gap-1 text-[11px] font-medium text-muted">
              {def.label}
              <InfoTip text={def.help} />
            </div>
            <div className={clsx("mt-1 text-lg font-semibold", signed ? signClass(v) : "text-fg")}>{def.format(v)}</div>
            {benchmark && <div className="text-[11px] text-muted">B&amp;H {def.format(b)}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Rows = metrics, columns = strategies. Best value per row is marked (not colored by rank). */
export function MetricsTable({ columns, rows }: { columns: { key: string; label: string; color?: string; metrics: Metrics }[]; rows: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-2 pr-4 font-medium">Metric</th>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5 text-fg-2">
                  {c.color && <span className="h-[3px] w-3 rounded-full" style={{ background: c.color }} />}
                  {c.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((key) => {
            const def = METRIC_BY_KEY[key];
            if (!def) return null;
            const vals = columns.map((c) => c.metrics[key] as number | null);
            const finite = vals.filter((v): v is number => v !== null && Number.isFinite(v));
            let best: number | null = null;
            if (def.better && finite.length > 1) best = def.better === "higher" ? Math.max(...finite) : Math.min(...finite);
            return (
              <tr key={key} className="border-b border-line/60 last:border-0">
                <td className="py-1.5 pr-4 text-fg-2">
                  <span className="inline-flex items-center gap-1">
                    {def.label}
                    <InfoTip text={def.help} />
                  </span>
                </td>
                {vals.map((v, i) => (
                  <td key={columns[i].key} className={clsx("px-3 py-1.5 text-right", v !== null && v === best ? "font-semibold text-fg" : "text-fg-2")}>
                    {def.format(v)}
                    {v !== null && v === best && <span className="ml-1 text-[10px] text-accent" title="Best in row">●</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type SortKey = keyof Trade;

export function TradesTable({ trades, filename, intraday }: { trades: Trade[]; filename: string; intraday?: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "entry_time", dir: -1 });
  const [page, setPage] = useState(0);
  const per = 25;
  const sorted = useMemo(() => {
    const out = [...trades];
    out.sort((a, b) => {
      const x = a[sort.key] as number | string | null;
      const y = b[sort.key] as number | string | null;
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x > y ? 1 : -1) * sort.dir;
    });
    return out;
  }, [trades, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  // Clamp: switching to a strategy with fewer trades must not leave the table on an empty page.
  const current = Math.min(page, pages - 1);
  const rows = sorted.slice(current * per, current * per + per);

  const head = (key: SortKey, label: string, right = true) => (
    <th className={clsx("px-2 py-2 font-medium", right && "text-right")}>
      <button
        className="inline-flex items-center gap-0.5 hover:text-fg"
        onClick={() => {
          setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }));
          setPage(0);
        }}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  if (!trades.length) return <p className="px-1 py-6 text-center text-sm text-muted">No completed trades in this window.</p>;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted">{trades.length} trades</span>
        <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => downloadCsv(trades as unknown as Record<string, unknown>[], filename)}>
          CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              {head("entry_time", "Entry", false)}
              {head("exit_time", "Exit", false)}
              {head("side", "Side", false)}
              {head("qty", "Qty")}
              {head("entry_price", "Entry px")}
              {head("exit_price", "Exit px")}
              {head("gross_pnl", "Gross P&L")}
              {head("costs", "Costs")}
              {head("net_pnl", "Net P&L")}
              {head("return", "Return")}
              {head("bars_held", "Bars")}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((t, i) => (
              <tr key={`${t.entry_time}-${i}`} className="border-b border-line/50 last:border-0">
                <td className="px-2 py-1.5 text-fg-2">{date(t.entry_time, intraday)}</td>
                <td className="px-2 py-1.5 text-fg-2">{date(t.exit_time, intraday)}</td>
                <td className="px-2 py-1.5 text-fg-2">{t.side}</td>
                <td className="px-2 py-1.5 text-right text-fg-2">{num(t.qty, t.qty !== null && t.qty < 10 ? 4 : 0)}</td>
                <td className="px-2 py-1.5 text-right text-fg-2">{price(t.entry_price)}</td>
                <td className="px-2 py-1.5 text-right text-fg-2">{price(t.exit_price)}</td>
                <td className={clsx("px-2 py-1.5 text-right", signClass(t.gross_pnl))}>{money(t.gross_pnl, true)}</td>
                <td className="px-2 py-1.5 text-right text-fg-2">{money(t.costs)}</td>
                <td className={clsx("px-2 py-1.5 text-right font-medium", signClass(t.net_pnl))}>{money(t.net_pnl, true)}</td>
                <td className={clsx("px-2 py-1.5 text-right", signClass(t.return))}>{pct(t.return, 2, true)}</td>
                <td className="px-2 py-1.5 text-right text-fg-2">{t.bars_held}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted">
          <Button size="sm" variant="ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Prev
          </Button>
          <span className="tabular">
            {current + 1} / {pages}
          </span>
          <Button size="sm" variant="ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
