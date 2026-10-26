export type Source = "yfinance" | "ccxt";

export interface Instrument {
  symbol: string;
  source: Source;
  interval: string;
  name: string;
  asset_class: "equity" | "crypto";
  snapshot: boolean;
  cached: boolean;
}

export interface Health {
  status: string;
  version: string;
  git_sha: string | null;
  offline: boolean;
  models: number;
  static: boolean;
}

export interface JsonSchemaProp {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  anyOf?: JsonSchemaProp[];
}

export interface StrategyInfo {
  name: string;
  label: string;
  description: string;
  kind: "benchmark" | "classical" | "ml";
  model_type: string | null;
  params_schema: { properties?: Record<string, JsonSchemaProp>; required?: string[] };
}

export interface CostPreset {
  name: string;
  label: string;
  description: string;
  commission: { buy_bps: number; sell_bps: number };
  slippage: { model: string; bps: number };
  fractional: boolean;
}

export interface Commission {
  buy_bps: number;
  sell_bps: number;
  fixed_fee: number;
  min_fee: number;
}

export interface Slippage {
  model: "fixed" | "range" | "sqrt_impact";
  bps: number;
  range_fraction: number;
  half_spread_bps: number;
  impact_coef: number;
  max_bps?: number;
}

export interface ExecutionIn {
  preset?: string | null;
  initial_capital: number;
  mode: "long_flat" | "long_short";
  max_leverage: number;
  fractional?: boolean | null;
  commission?: Commission | null;
  slippage?: Slippage | null;
  borrow_rate: number;
  /** Annual interest on idle cash; null = the risk-free rate. */
  cash_rate?: number | null;
}

export interface StrategySpec {
  name: string;
  params: Record<string, unknown>;
  label?: string;
  trials?: number;
  trial_sharpe_std?: number | null;
}

export type WindowName = "custom" | "train" | "val" | "test" | "model_test" | "full";

export interface Metrics {
  total_return: number | null;
  cagr: number | null;
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown: number | null;
  max_drawdown_duration_bars: number;
  max_drawdown_duration_days: number | null;
  calmar: number | null;
  best_period: number | null;
  worst_period: number | null;
  skew: number | null;
  kurtosis: number | null;
  psr: number | null;
  trades: number;
  win_rate: number | null;
  avg_win: number | null;
  avg_loss: number | null;
  profit_factor: number | null;
  avg_trade_return: number | null;
  avg_bars_held: number | null;
  turnover: number | null;
  exposure: number | null;
  total_costs: number | null;
  fees: number | null;
  slippage_cost: number | null;
  borrow_cost: number | null;
  final_equity: number | null;
  n_periods: number;
  years: number | null;
  start: string;
  end: string;
  [key: string]: number | string | null;
}

export interface Trade {
  entry_time: string;
  exit_time: string;
  side: "long" | "short";
  qty: number | null;
  entry_price: number | null;
  exit_price: number | null;
  gross_pnl: number | null;
  costs: number | null;
  fees: number | null;
  slippage: number | null;
  net_pnl: number | null;
  return: number | null;
  bars_held: number;
}

export interface Fill {
  time: number;
  side: "buy" | "sell";
  price: number | null;
  qty: number | null;
  reason: string;
}

export interface StrategyMeta {
  key: string;
  name: string;
  label: string;
  kind: string;
  params: Record<string, unknown>;
  trials: number;
  model_id: string | null;
}

export interface ClassificationReport {
  n: number;
  threshold: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number | null;
  log_loss: number;
  base_rate: number;
  predicted_positive_rate: number;
  confusion_matrix: [[number, number], [number, number]];
  at_trading_threshold?: ClassificationReport;
  threshold_report?: ClassificationReport;
  sharpe_after_costs?: number | null;
  roc_curve?: { fpr: number; tpr: number }[];
}

export interface MonthlyReturn {
  year: number;
  month: number;
  return: number | null;
}

interface RunBase {
  run_id?: string;
  created_at?: string;
  name?: string | null;
  symbol: string;
  source: Source;
  interval: string;
  window: { name: string; start: string; end: string };
  in_sample: boolean;
  held_out_start: string | null;
  warnings: string[];
  strategies: StrategyMeta[];
  execution: ExecutionIn & { preset: string | null; commission: Commission; slippage: Slippage };
  risk_free_rate: number;
  periods_per_year: number;
  model_ids: string[];
  data_hash: string;
  git_sha: string | null;
}

export interface BacktestResponse extends RunBase {
  kind: "backtest";
  strategy: StrategyMeta;
  metrics: Metrics;
  benchmark_metrics: Metrics | null;
  series: {
    timestamp: number[];
    equity: (number | null)[];
    drawdown: (number | null)[];
    exposure: (number | null)[];
    target: (number | null)[];
    open: (number | null)[];
    high: (number | null)[];
    low: (number | null)[];
    close: (number | null)[];
    volume: (number | null)[];
    benchmark_equity?: (number | null)[];
    benchmark_drawdown?: (number | null)[];
    proba?: (number | null)[];
  };
  trades: Trade[];
  fills: Fill[];
  monthly_returns: MonthlyReturn[];
  diagnostics: ClassificationReport | null;
}

export interface SharpeDiff {
  estimate: number;
  ci_low: number;
  ci_high: number;
  p_value: number;
  significant: boolean;
  samples: number;
  block_size: number;
  histogram: { edges: number[]; counts: number[] };
}

export interface Sensitivity {
  levels: number[];
  strategies: Record<string, { sharpe: (number | null)[]; cagr: (number | null)[]; total_return: (number | null)[]; break_even_bps: number | null }>;
}

export interface CompareResponse extends RunBase {
  kind: "compare";
  baseline: string;
  metrics: Record<string, Metrics>;
  dsr: Record<string, { dsr: number | null; sr0_annual: number | null; n_trials: number }>;
  sharpe_diff: Record<string, SharpeDiff | null>;
  ranking: string[];
  verdict: string;
  series: {
    timestamp: number[];
    close: (number | null)[];
    equity: Record<string, (number | null)[]>;
    drawdown: Record<string, (number | null)[]>;
  };
  trades: Record<string, Trade[]>;
  monthly_returns: Record<string, MonthlyReturn[]>;
  sensitivity: Sensitivity | null;
  diagnostics: Record<string, ClassificationReport | null>;
}

export type RunPayload = BacktestResponse | CompareResponse;

export interface RunSummary {
  id: string;
  created_at: string;
  kind: "backtest" | "compare";
  name: string | null;
  symbol: string;
  source: Source;
  interval: string;
  start: string;
  end: string;
  strategies: string[];
  model_ids: string[];
  in_sample: boolean;
  metrics: Record<string, Partial<Metrics>>;
  data_hash: string;
}

export interface ModelSummary {
  model_id: string;
  model_type: "xgboost" | "lstm";
  symbol: string;
  source: Source;
  interval: string;
  feature_set: string;
  label_method: string;
  splits: ModelSplits;
  threshold: { long: number; short: number };
  created_at: string;
  trials: number | null;
  training_env?: string | null;
  val_metrics: { accuracy: number | null; roc_auc: number | null; f1: number | null; sharpe_after_costs: number | null };
  test_evaluations: number;
}

export interface ModelSplits {
  train: [string, string];
  val: [string, string];
  test: [string, string | null];
  embargo_bars: number;
  train_used?: [string, string, number] | null;
  val_used?: [string, string, number] | null;
  test_used?: [string, string, number] | null;
}

export interface ModelDetail {
  model_id: string;
  model_type: "xgboost" | "lstm";
  artifact: string;
  symbol: string;
  source: Source;
  interval: string;
  feature_set: string;
  features: string[];
  label: Record<string, unknown> & { method: string };
  splits: ModelSplits;
  embargo_bars: number;
  seq_len: number | null;
  threshold: { long: number; short: number };
  threshold_search?: { threshold: number; sharpe: number | null; total_return: number | null; trades: number }[];
  cost_preset?: string;
  hyperparameters: Record<string, unknown>;
  cv: Record<string, unknown> & { trials?: number };
  metrics: { train?: ClassificationReport; val?: ClassificationReport };
  history?: Record<string, (number | null)[]>;
  feature_importance?: Record<string, number> | null;
  data_hash: string;
  data_range?: [string, string];
  seed: number;
  created_at: string;
  training_seconds?: number;
  library_versions?: Record<string, string>;
  files: string[];
  test_evaluations: number;
  onnx_parity_max_abs_diff?: number | null;
}

export interface QualityReport {
  bars: number;
  start?: string;
  end?: string;
  expected_bars?: number | null;
  missing_bars?: number | null;
  duplicates?: number;
  nan_counts?: Record<string, number>;
  non_positive_prices?: number;
  zero_volume_bars?: number;
  ohlc_inconsistent?: number;
  outliers?: { timestamp: string; return: number }[];
  return_sigma?: number;
  issues: { severity: "info" | "warning" | "error"; check: string; message: string }[];
  ok?: boolean;
}

export interface OhlcvResponse {
  symbol: string;
  bars: number;
  data_hash: string;
  timestamp: number[];
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  volume: (number | null)[];
}

export interface TuneResult {
  best: { fast: number; slow: number; ma_type: string };
  best_val_sharpe: number;
  grid: { fast: number; slow: number; train_sharpe: number | null; val_sharpe: number | null; val_return: number | null; val_trades: number }[];
  trials: number;
  trial_sharpe_std: number | null;
  train: [string, string];
  val: [string, string];
}

export interface MarketOverview {
  symbol: string;
  source: Source;
  interval: string;
  name: string;
  asset_class: "equity" | "crypto";
  last_close: number | null;
  last_time: string;
  change_1d: number | null;
  change_30d: number | null;
  change_1y: number | null;
  volatility_1y: number | null;
  bars: number;
  sparkline: (number | null)[];
}

export interface Finding {
  run_id: string;
  name: string | null;
  /** True when this is the research study's comparison; false for the latest ad-hoc one. */
  study: boolean;
  created_at: string;
  symbol: string;
  source: Source;
  interval: string;
  window: { name: string; start: string; end: string };
  in_sample: boolean;
  execution: { preset: string | null };
  strategies: { key: string; name: string; label: string; kind: string }[];
  metrics: Record<string, { total_return: number | null; cagr: number | null; sharpe: number | null; sortino: number | null; max_drawdown: number | null; calmar: number | null; psr: number | null; trades: number }>;
  dsr: Record<string, { dsr: number | null; sr0_annual: number | null; n_trials: number }>;
  sharpe_diff: Record<string, { estimate: number; ci_low: number; ci_high: number; p_value: number; significant: boolean } | null>;
  baseline: string;
  ranking: string[];
  verdict: string;
}

export interface StudyStatus {
  state: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  current: string;
  errors: string[];
  has_runs?: boolean;
}

export interface Splits {
  equity: { train: [string, string]; val: [string, string]; test: [string, string | null]; embargo_bars: number };
  crypto: { train: [string, string]; val: [string, string]; test: [string, string | null]; embargo_bars: number };
}
