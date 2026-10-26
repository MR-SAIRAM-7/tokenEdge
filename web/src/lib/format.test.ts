import { describe, expect, it } from "vitest";
import { strategyColor } from "./colors";
import { downsampleIndices } from "./downsample";
import { isIntraday, niceTicks, num, pct } from "./format";

describe("format", () => {
  it("formats percentages and numbers", () => {
    expect(pct(0.1234, 1)).toBe("12.3%");
    expect(pct(0.05, 1, true)).toBe("+5.0%");
    expect(pct(null)).toBe("—");
    expect(num(Number.NaN)).toBe("—");
    expect(isIntraday("1h")).toBe(true);
    expect(isIntraday("1d")).toBe(false);
  });

  it("picks round axis ticks that cover the range", () => {
    // The LSTM bootstrap interval that once lost most of its axis labels.
    const { ticks, digits } = niceTicks(-1.62, 1.08);
    expect(ticks).toEqual([-2, -1, 0, 1, 2]);
    expect(digits).toBe(0);
    const fine = niceTicks(-0.37, 0.12);
    expect(fine.ticks[0]).toBeLessThanOrEqual(-0.37);
    expect(fine.ticks[fine.ticks.length - 1]).toBeGreaterThanOrEqual(0.12);
    expect(fine.ticks).toContain(0);
    expect(fine.digits).toBe(1);
    expect(niceTicks(1, 1).ticks).toEqual([1]);
  });
});

describe("downsample", () => {
  it("keeps endpoints and extremes", () => {
    const values = Array.from({ length: 10_000 }, (_, i) => Math.sin(i / 50));
    values[4321] = -5;
    const idx = downsampleIndices(values.length, [values], 500);
    expect(idx.length).toBeLessThanOrEqual(520);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(9999);
    expect(idx).toContain(4321);
  });
});

describe("colors", () => {
  it("color follows the strategy, not its position", () => {
    expect(strategyColor("xgboost", "light")).toBe(strategyColor("xgboost", "light"));
    expect(strategyColor("sma_crossover", "dark")).not.toBe(strategyColor("xgboost", "dark"));
    expect(strategyColor("sma_crossover_2", "light")).not.toBe(strategyColor("sma_crossover", "light"));
  });
});

describe("share", () => {
  it("round-trips a configuration through the URL parameter", async () => {
    const { decodeConfig, encodeConfig } = await import("./share");
    const cfg = { market: { symbol: "RELIANCE.NS", source: "yfinance" }, params: { fast: 20, note: "₹ & ü" } };
    const param = encodeConfig(cfg);
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeConfig(param)).toEqual(cfg);
    expect(decodeConfig("not-base64!")).toBeNull();
    expect(decodeConfig(null)).toBeNull();
  });
});
