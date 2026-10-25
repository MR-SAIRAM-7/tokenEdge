/**
 * Pick at most ~maxPoints indices while keeping each bucket's min and max of every series,
 * so drawdown troughs and equity peaks survive downsampling for SVG charts.
 */
export function downsampleIndices(n: number, series: (number | null)[][], maxPoints = 1200): number[] {
  if (n <= maxPoints) return Array.from({ length: n }, (_, i) => i);
  const buckets = Math.max(1, Math.floor(maxPoints / (2 * Math.max(1, series.length) + 1)));
  const size = n / buckets;
  const keep = new Set<number>([0, n - 1]);
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor(b * size);
    const hi = Math.min(n, Math.floor((b + 1) * size));
    if (hi <= lo) continue;
    keep.add(lo);
    for (const s of series) {
      let minI = -1;
      let maxI = -1;
      for (let i = lo; i < hi; i++) {
        const v = s[i];
        if (v === null || v === undefined) continue;
        if (minI < 0 || v < (s[minI] as number)) minI = i;
        if (maxI < 0 || v > (s[maxI] as number)) maxI = i;
      }
      if (minI >= 0) keep.add(minI);
      if (maxI >= 0) keep.add(maxI);
    }
  }
  return Array.from(keep).sort((a, b) => a - b);
}
