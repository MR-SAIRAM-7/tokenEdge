import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHROME } from "../../lib/colors";
import { useTheme } from "../../state/theme";
import { Legend } from "./TimeSeriesChart";

export interface XYSeries {
  key: string;
  label: string;
  color: string;
  points: { x: number; y: number | null }[];
  dots?: boolean;
}

interface Props {
  series: XYSeries[];
  xLabel: string;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  height?: number;
  refX?: { x: number; label: string } | null;
  refY?: number | null;
  diagonal?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  xTicks?: number[];
}

/** Line chart with a numeric x axis (cost in bps, threshold, epoch, FPR...). */
export function XYChart({ series, xLabel, xFormat, yFormat, height = 240, refX, refY, diagonal, xDomain, yDomain, xTicks }: Props) {
  const { mode } = useTheme();
  const c = CHROME[mode];
  const xs = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.x)))).sort((a, b) => a - b);
  const data = xs.map((x) => {
    const row: Record<string, number | null> = { x };
    for (const s of series) row[s.key] = s.points.find((p) => p.x === x)?.y ?? null;
    return row;
  });

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-2">
          <Legend items={series} />
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 16, bottom: 16, left: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="x"
              type="number"
              domain={xDomain ?? ["dataMin", "dataMax"]}
              ticks={xTicks}
              tickFormatter={(v: number) => xFormat(v)}
              stroke={c.axis}
              tickLine={false}
              label={{ value: xLabel, position: "insideBottom", offset: -10, fill: c.muted, fontSize: 11 }}
            />
            <YAxis tickFormatter={(v: number) => yFormat(v)} stroke={c.axis} tickLine={false} axisLine={false} width={56} domain={yDomain ?? ["auto", "auto"]} />
            {refY !== undefined && refY !== null && <ReferenceLine y={refY} stroke={c.axis} />}
            {refX && (
              <ReferenceLine x={refX.x} stroke={c.muted} label={{ value: refX.label, position: "insideTopRight", fill: c.muted, fontSize: 11 }} />
            )}
            {diagonal && (
              <ReferenceLine
                segment={[
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ]}
                stroke={c.axis}
              />
            )}
            <Tooltip
              cursor={{ stroke: c.muted, strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
                    <div className="mb-1 font-medium text-fg">
                      {xLabel}: {xFormat(label as number)}
                    </div>
                    {series.map((s) => {
                      const p = payload.find((q) => q.dataKey === s.key);
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
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={s.dots ? { r: 4, fill: s.color, stroke: c.surface, strokeWidth: 2 } : false}
                activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
