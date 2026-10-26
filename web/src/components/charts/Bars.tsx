import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SharpeDiff } from "../../api/types";
import { CHROME } from "../../lib/colors";
import { niceTicks, num } from "../../lib/format";
import { useTheme } from "../../state/theme";

export interface HBarItem {
  label: string;
  value: number | null;
  color: string;
  note?: string;
}

/** Horizontal bars, value at the tip. Used for feature importance and PSR/DSR. */
export function HBarChart({ items, format, domain, rowHeight = 30 }: { items: HBarItem[]; format: (v: number) => string; domain?: [number, number]; rowHeight?: number }) {
  const { mode } = useTheme();
  const c = CHROME[mode];
  const data = items.map((i) => ({ ...i, v: i.value ?? 0 }));
  return (
    <div style={{ height: Math.max(80, items.length * rowHeight + 30) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={domain ?? [0, "auto"]} tickFormatter={(v: number) => format(v)} stroke={c.axis} tickLine={false} />
          <YAxis type="category" dataKey="label" width={130} tickLine={false} axisLine={false} stroke={c.axis} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as HBarItem & { v: number };
              return (
                <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium text-fg">{p.label}</div>
                  <div className="tabular text-fg-2">{p.value == null ? "n/a" : format(p.value)}</div>
                  {p.note && <div className="mt-0.5 text-muted">{p.note}</div>}
                </div>
              );
            }}
          />
          <Bar dataKey="v" barSize={Math.min(20, rowHeight - 8)} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
            <LabelList dataKey="v" position="right" formatter={(v: unknown) => format(Number(v))} style={{ fill: c.text, fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Bootstrap distribution of a Sharpe difference with its 95% CI and the zero line. */
export function BootstrapHistogram({ diff, color, height = 180 }: { diff: SharpeDiff; color: string; height?: number }) {
  const { mode } = useTheme();
  const c = CHROME[mode];
  const { edges, counts } = diff.histogram;
  const data = counts.map((n, i) => ({ mid: (edges[i] + edges[i + 1]) / 2, n }));
  // Explicit round ticks: Recharts' automatic ticks on an un-rounded domain can drop most labels.
  const { ticks, digits } = niceTicks(Math.min(edges[0], 0), Math.max(edges[edges.length - 1], 0), 6);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barCategoryGap={1}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="mid"
            type="number"
            domain={[ticks[0], ticks[ticks.length - 1]]}
            ticks={ticks}
            interval="preserveStartEnd"
            tickFormatter={(v: number) => num(v, digits)}
            stroke={c.axis}
            tickLine={false}
          />
          <YAxis hide />
          <ReferenceArea x1={diff.ci_low} x2={diff.ci_high} fill={color} fillOpacity={0.08} />
          <ReferenceLine x={0} stroke={c.text} strokeWidth={1} label={{ value: "0", position: "top", fill: c.muted, fontSize: 11 }} />
          <ReferenceLine x={diff.estimate} stroke={color} strokeWidth={2} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { mid: number; n: number };
              return (
                <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
                  <div className="text-fg">Sharpe diff ≈ {num(p.mid, 2)}</div>
                  <div className="text-muted">{p.n} of {diff.samples} resamples</div>
                </div>
              );
            }}
          />
          <Bar dataKey="n" fill={color} fillOpacity={0.75} radius={[3, 3, 0, 0]} isAnimationActive={false} barSize={Math.max(2, Math.min(24, 600 / Math.max(counts.length, 1)))} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
