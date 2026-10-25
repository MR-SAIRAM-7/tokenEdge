// Chart palette (validated with the dataviz palette checker in both modes).
// Color follows the strategy, never its rank: SMA is always blue, XGBoost orange, etc.

export type Mode = "light" | "dark";

const SERIES: Record<Mode, string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#eda100", "#e87ba4"],
  dark: ["#3987e5", "#d95926", "#199e70", "#9085e9", "#c98500", "#d55181"],
};

const SLOT_BY_STRATEGY: Record<string, number> = {
  sma_crossover: 0,
  xgboost: 1,
  lstm: 2,
  buy_hold: 3,
  sma_ml_filter: 4,
};

export function strategyColor(key: string, mode: Mode): string {
  const base = key.replace(/_\d+$/, "");
  const dup = key.match(/_(\d+)$/);
  let slot = SLOT_BY_STRATEGY[base] ?? 4;
  if (dup && base in SLOT_BY_STRATEGY) slot = 5;
  return SERIES[mode][slot % SERIES[mode].length];
}

export const CHROME: Record<Mode, { surface: string; text: string; muted: string; grid: string; axis: string; up: string; down: string; buy: string; sell: string; volume: string; accent: string }> = {
  light: {
    surface: "#ffffff",
    text: "#0f1115",
    muted: "#747b8a",
    grid: "#eceef1",
    axis: "#c3c2b7",
    up: "#1baf7a",
    down: "#e34948",
    buy: "#2a78d6",
    sell: "#eb6834",
    volume: "rgba(116,123,138,0.28)",
    accent: "#2a78d6",
  },
  dark: {
    surface: "#14161a",
    text: "#eef0f3",
    muted: "#868d9a",
    grid: "#20242a",
    axis: "#383835",
    up: "#199e70",
    down: "#e66767",
    buy: "#3987e5",
    sell: "#d95926",
    volume: "rgba(134,141,154,0.25)",
    accent: "#3987e5",
  },
};

// Diverging blue <-> red with a neutral gray midpoint (for return heatmaps).
const DIVERGING: Record<Mode, { neg: string[]; mid: string; pos: string[] }> = {
  light: {
    neg: ["#fbe3e2", "#f4b6b4", "#eb8583", "#e34948", "#b8302f"],
    mid: "#f0efec",
    pos: ["#dbe9fb", "#b7d3f6", "#86b6ef", "#3987e5", "#1c5cab"],
  },
  dark: {
    neg: ["#3a2424", "#5c2b2b", "#8a3a3a", "#c24d4d", "#e66767"],
    mid: "#2a2b2e",
    pos: ["#1c2a3d", "#1e3a5f", "#22508a", "#2f6fbf", "#3987e5"],
  },
};

export function divergingColor(value: number | null, maxAbs: number, mode: Mode): string {
  const d = DIVERGING[mode];
  if (value === null || !Number.isFinite(value) || maxAbs <= 0) return d.mid;
  const t = Math.min(Math.abs(value) / maxAbs, 1);
  if (t < 0.04) return d.mid;
  const idx = Math.min(4, Math.floor(t * 5));
  return value > 0 ? d.pos[idx] : d.neg[idx];
}

export function textOn(bg: string): string {
  const hex = bg.replace("#", "");
  if (hex.length !== 6) return "#0f1115";
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#0f1115" : "#ffffff";
}
