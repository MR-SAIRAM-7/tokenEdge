import { Download } from "lucide-react";
import { useMemo, useRef } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHROME } from "../../lib/colors";
import { downsampleIndices } from "../../lib/downsample";
import { downloadSvgAsPng } from "../../lib/download";
import { date, tickDate } from "../../lib/format";
import { useTheme } from "../../state/theme";

export interface TSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  area?: boolean;
  dim?: boolean;
}

interface Props {
  timestamps: number[];
  series: TSeries[];
  yFormat: (v: number) => string;
  height?: number;
  intraday?: boolean;
  zeroLine?: boolean;
  legendValue?: (s: TSeries) => string;
  exportName?: string;
  maxPoints?: number;
}

export function Legend({ items }: { items: { key: string; label: string; color: string; value?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
      {items.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-[3px] w-3.5 rounded-full" style={{ background: s.color }} />
          {s.label}
          {s.value && <span className="tabular text-muted">{s.value}</span>}
        </span>
      ))}
    </div>
  );
}

export function TimeSeriesChart({ timestamps, series, yFormat, height = 280, intraday, zeroLine, legendValue, exportName, maxPoints = 1200 }: Props) {
  const { mode } = useTheme();
  const c = CHROME[mode];
  const box = useRef<HTMLDivElement>(null);

  const data = useMemo(() => {
    const idx = downsampleIndices(timestamps.length, series.map((s) => s.values), maxPoints);
    return idx.map((i) => {
      const row: Record<string, number | null> = { t: timestamps[i] };
      for (const s of series) row[s.key] = s.values[i] ?? null;
      return row;
    });
  }, [timestamps, series, maxPoints]);

  const spanDays = timestamps.length > 1 ? (timestamps[timestamps.length - 1] - timestamps[0]) / 86400 : 1;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {series.length > 1 ? <Legend items={series.map((s) => ({ key: s.key, label: s.label, color: s.color, value: legendValue?.(s) }))} /> : <span />}
        {exportName && (
          <button
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
            onClick={() => downloadSvgAsPng(box.current, `${exportName}.png`, c.surface)}
            title="Download PNG"
          >
            <Download className="size-3.5" /> PNG
          </button>
        )}
      </div>
      <div ref={box} style={{ height }} role="img" aria-label={series.map((s) => s.label).join(", ")}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => tickDate(v, !!intraday, spanDays)}
              stroke={c.axis}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis tickFormatter={(v: number) => yFormat(v)} stroke={c.axis} tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} />
            {zeroLine && <ReferenceLine y={0} stroke={c.axis} strokeWidth={1} />}
            <Tooltip
              cursor={{ stroke: c.muted, strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
                    <div className="mb-1 font-medium text-fg">{date(label as number, !!intraday)}</div>
                    {series.map((s) => {
                      const p = payload.find((x) => x.dataKey === s.key);
                      if (!p || p.value == null) return null;
                      return (
                        <div key={s.key} className="flex items-center justify-between gap-4">
                          <span className="inline-flex items-center gap-1.5 text-fg-2">
                            <span className="size-2 rounded-full" style={{ background: s.color }} />
                            {s.label}
                          </span>
                          <span className="tabular text-fg">{yFormat(p.value as number)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {series.map((s) =>
              s.area ? (
                <Area
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ) : (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeOpacity={s.dim ? 0.55 : 1}
                  dot={false}
                  activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
