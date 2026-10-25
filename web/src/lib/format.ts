export const dash = "—";

export function pct(x: number | null | undefined, digits = 1, signed = false): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return dash;
  const v = (x * 100).toFixed(digits);
  return `${signed && x > 0 ? "+" : ""}${v}%`;
}

export function num(x: number | null | undefined, digits = 2, signed = false): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return dash;
  const s = x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return signed && x > 0 ? `+${s}` : s;
}

export function int(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return dash;
  return Math.round(x).toLocaleString();
}

export function compact(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return dash;
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: digits }).format(x);
}

export function money(x: number | null | undefined, signed = false): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return dash;
  const abs = Math.abs(x);
  const digits = abs >= 1000 ? 0 : 2;
  const s = abs.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (x < 0) return `−${s}`;
  return signed && x > 0 ? `+${s}` : s;
}

export function price(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return dash;
  const digits = x >= 1000 ? 2 : x >= 1 ? 2 : 6;
  return x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function date(iso: string | number | null | undefined, withTime = false): string {
  if (iso === null || iso === undefined) return dash;
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  if (Number.isNaN(d.getTime())) return dash;
  const day = d.toISOString().slice(0, 10);
  return withTime ? `${day} ${d.toISOString().slice(11, 16)}` : day;
}

export function dateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return dash;
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function isIntraday(interval: string): boolean {
  return /\d+(m|h)$/.test(interval);
}

export function tickDate(ts: number, intraday: boolean, spanDays: number): string {
  const d = new Date(ts * 1000);
  if (intraday && spanDays < 10) return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}h`;
  if (spanDays < 400) return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function signClass(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x) || x === 0) return "text-fg";
  return x > 0 ? "text-pos" : "text-neg";
}
