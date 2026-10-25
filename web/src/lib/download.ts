export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const text = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
  downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), filename);
}

/** Render the first <svg> inside `container` (a Recharts chart) to a PNG file. */
export async function downloadSvgAsPng(container: HTMLElement | null, filename: string, background: string) {
  const svg = container?.querySelector("svg.recharts-surface") ?? container?.querySelector("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(rect.width));
  clone.setAttribute("height", String(rect.height));
  // Inline computed text colors so axis labels survive outside the page's CSS.
  const styleTargets = svg.querySelectorAll("text, line, path");
  const cloneTargets = clone.querySelectorAll("text, line, path");
  styleTargets.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = cloneTargets[i] as SVGElement;
    if (el.tagName === "text") target.setAttribute("fill", cs.fill);
    else if (cs.stroke && cs.stroke !== "none" && !target.getAttribute("stroke")) target.setAttribute("stroke", cs.stroke);
  });
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const scale = 2;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("PNG export failed"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  canvas.toBlob((blob) => blob && downloadBlob(blob, filename), "image/png");
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => blob && downloadBlob(blob, filename), "image/png");
}
