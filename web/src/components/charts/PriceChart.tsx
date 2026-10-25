import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Fill } from "../../api/types";
import { CHROME } from "../../lib/colors";
import { useTheme } from "../../state/theme";

export interface Overlay {
  name: string;
  values: (number | null)[];
  color: string;
}

export interface PriceChartHandle {
  screenshot: () => HTMLCanvasElement | null;
}

interface Props {
  timestamps: number[];
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  volume?: (number | null)[];
  overlays?: Overlay[];
  rsi?: (number | null)[] | null;
  macd?: { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } | null;
  fills?: Fill[];
  intraday?: boolean;
  height?: number;
  handle?: Ref<PriceChartHandle>;
}

const t = (x: number) => x as UTCTimestamp;

function line(ts: number[], values: (number | null)[]) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) out.push({ time: t(ts[i]), value: v });
  }
  return out;
}

export function PriceChart({ timestamps, open, high, low, close, volume, overlays = [], rsi, macd, fills, intraday, height = 420, handle }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { mode } = useTheme();

  useImperativeHandle(handle, () => ({ screenshot: () => chartRef.current?.takeScreenshot(true, false) ?? null }), []);

  useEffect(() => {
    const el = ref.current;
    if (!el || timestamps.length === 0) return;
    const c = CHROME[mode];
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c.surface },
        textColor: c.muted,
        fontSize: 11,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        attributionLogo: false,
        panes: { separatorColor: c.grid, separatorHoverColor: c.grid, enableResize: true },
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.axis },
      timeScale: { borderColor: c.axis, timeVisible: !!intraday, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
      borderVisible: false,
      priceLineVisible: false,
    });
    const bars = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = open[i], h = high[i], l = low[i], cl = close[i];
      if (o == null || h == null || l == null || cl == null) continue;
      bars.push({ time: t(timestamps[i]), open: o, high: h, low: l, close: cl });
    }
    candles.setData(bars);

    if (volume) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: c.volume, priceLineVisible: false, lastValueVisible: false });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      vol.setData(line(timestamps, volume).map((p) => ({ ...p })));
    }

    for (const o of overlays) {
      const s = chart.addSeries(LineSeries, { color: o.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: o.name });
      s.setData(line(timestamps, o.values));
    }

    if (fills?.length) {
      const markers: SeriesMarker<UTCTimestamp>[] = fills
        .filter((f) => f.reason !== "end_of_window")
        .map((f) => ({
          time: t(f.time),
          position: f.side === "buy" ? "belowBar" : "aboveBar",
          color: f.side === "buy" ? c.buy : c.sell,
          shape: f.side === "buy" ? "arrowUp" : "arrowDown",
          text: f.side === "buy" ? "B" : "S",
        }));
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candles, markers);
    }

    let pane = 1;
    if (rsi) {
      const s = chart.addSeries(LineSeries, { color: c.accent, lineWidth: 2, priceLineVisible: false, title: "RSI 14" }, pane);
      s.setData(line(timestamps, rsi));
      for (const level of [30, 70]) s.createPriceLine({ price: level, color: c.axis, lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: "" });
      chart.panes()[pane]?.setStretchFactor(100);
      pane += 1;
    }
    if (macd) {
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      hist.setData(
        line(timestamps, macd.hist).map((p) => ({ ...p, color: p.value >= 0 ? c.up : c.down })),
      );
      const m = chart.addSeries(LineSeries, { color: c.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "MACD" }, pane);
      m.setData(line(timestamps, macd.macd));
      const sig = chart.addSeries(LineSeries, { color: c.sell, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "Signal" }, pane);
      sig.setData(line(timestamps, macd.signal));
      chart.panes()[pane]?.setStretchFactor(110);
    }

    chart.panes()[0]?.setStretchFactor(height);
    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [timestamps, open, high, low, close, volume, overlays, rsi, macd, fills, intraday, mode, height]);

  const extra = (rsi ? 100 : 0) + (macd ? 110 : 0);
  return <div ref={ref} style={{ height: height + extra }} className="w-full overflow-hidden rounded-lg" />;
}
