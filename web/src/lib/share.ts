// Page configurations kept in the URL (`?config=`), so a setup can be shared by link.

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeConfig(value: unknown): string {
  return toBase64Url(JSON.stringify(value));
}

/** The decoded configuration, or null when the parameter is missing or malformed. */
export function decodeConfig<T>(param: string | null): T | null {
  if (!param) return null;
  try {
    const value = JSON.parse(fromBase64Url(param));
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

export function shareUrl(path: string, value: unknown): string {
  return `${window.location.origin}${path}?config=${encodeConfig(value)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
