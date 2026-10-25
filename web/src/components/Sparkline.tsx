/** Tiny inline trend line (single series, no axes). */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = "var(--accent)",
  fill = true,
  className,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
}) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null && Number.isFinite(p[1]));
  if (pts.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const n = values.length - 1 || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / n) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      {fill && <path d={`${d} L${x(last[0]).toFixed(1)},${height} L${x(pts[0][0]).toFixed(1)},${height} Z`} fill={color} opacity={0.1} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r={2.5} fill={color} />
    </svg>
  );
}
