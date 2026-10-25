import { int, money, num, pct } from "./format";

export interface MetricDef {
  key: string;
  label: string;
  help: string;
  format: (x: number | null | undefined) => string;
  better?: "higher" | "lower";
}

export const METRICS: MetricDef[] = [
  { key: "total_return", label: "Total return", help: "Final equity / initial capital − 1, after all costs.", format: (x) => pct(x, 1, true), better: "higher" },
  { key: "cagr", label: "CAGR", help: "Compound annual growth rate over the window.", format: (x) => pct(x, 1, true), better: "higher" },
  { key: "volatility", label: "Volatility", help: "Annualized standard deviation of per-bar returns.", format: (x) => pct(x, 1), better: "lower" },
  { key: "sharpe", label: "Sharpe", help: "Annualized mean excess return divided by its standard deviation (risk-free rate subtracted).", format: (x) => num(x, 2), better: "higher" },
  { key: "sortino", label: "Sortino", help: "Like Sharpe, but only downside volatility counts as risk.", format: (x) => num(x, 2), better: "higher" },
  { key: "max_drawdown", label: "Max drawdown", help: "Largest peak-to-trough fall of the equity curve.", format: (x) => pct(x, 1), better: "higher" },
  { key: "max_drawdown_duration_days", label: "Longest drawdown", help: "Longest time spent below a previous equity peak, in calendar days.", format: (x) => (x == null ? "—" : `${int(x)} d`), better: "lower" },
  { key: "calmar", label: "Calmar", help: "CAGR divided by the absolute max drawdown.", format: (x) => num(x, 2), better: "higher" },
  { key: "psr", label: "PSR", help: "Probabilistic Sharpe Ratio: probability that the true Sharpe is above 0, adjusted for skewness, kurtosis and sample length.", format: (x) => pct(x, 0), better: "higher" },
  { key: "trades", label: "Trades", help: "Completed round-trip trades.", format: (x) => int(x) },
  { key: "win_rate", label: "Win rate", help: "Share of trades with positive net P&L.", format: (x) => pct(x, 0), better: "higher" },
  { key: "profit_factor", label: "Profit factor", help: "Gross winning P&L divided by gross losing P&L.", format: (x) => num(x, 2), better: "higher" },
  { key: "avg_trade_return", label: "Avg trade", help: "Average net return per trade.", format: (x) => pct(x, 2, true), better: "higher" },
  { key: "avg_bars_held", label: "Avg bars held", help: "Average holding period per trade, in bars.", format: (x) => num(x, 1) },
  { key: "exposure", label: "Exposure", help: "Share of bars with an open position.", format: (x) => pct(x, 0) },
  { key: "turnover", label: "Turnover", help: "Traded value per year as a multiple of average equity.", format: (x) => (x == null ? "—" : `${num(x, 1)}×`), better: "lower" },
  { key: "total_costs", label: "Costs paid", help: "Commissions + slippage + borrow costs, in account currency.", format: (x) => money(x), better: "lower" },
  { key: "skew", label: "Skew", help: "Skewness of per-bar returns.", format: (x) => num(x, 2) },
  { key: "kurtosis", label: "Kurtosis", help: "Kurtosis of per-bar returns (3 = normal).", format: (x) => num(x, 1) },
  { key: "final_equity", label: "Final equity", help: "Equity at the end of the window.", format: (x) => money(x), better: "higher" },
];

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.key, m]));

export const KPI_KEYS = ["total_return", "cagr", "sharpe", "sortino", "max_drawdown", "trades", "exposure", "total_costs"];

export const COMPARE_KEYS = [
  "total_return", "cagr", "volatility", "sharpe", "sortino", "max_drawdown", "calmar", "psr",
  "trades", "win_rate", "profit_factor", "exposure", "turnover", "total_costs",
];
