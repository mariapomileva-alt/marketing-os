/** Human-readable locator: "Part A › Detail, lines 5–8", "at 01:07", "row 12", "$.meta". */
export function formatLocator(loc: Record<string, unknown> | null | undefined): string {
  if (!loc) return "";
  const parts: string[] = [];
  const hp = Array.isArray(loc.heading_path) ? (loc.heading_path as string[]).filter(Boolean) : [];
  if (hp.length) parts.push(hp.slice(-2).join(" › "));
  if (typeof loc.line_start === "number") parts.push(loc.line_end && loc.line_end !== loc.line_start ? `lines ${loc.line_start}–${loc.line_end}` : `line ${loc.line_start}`);
  if (typeof loc.timestamp === "string") parts.push(`at ${loc.timestamp}`);
  if (typeof loc.page === "number") parts.push(`page ${loc.page}`);
  if (typeof loc.row === "number") parts.push(`row ${loc.row}`);
  if (typeof loc.json_path === "string") parts.push(loc.json_path);
  return parts.join(", ");
}

export function formatDateTime(iso: string | Date | null | undefined, tz = "Europe/Riga"): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatDate(iso: string | Date | null | undefined, tz = "Europe/Riga"): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function formatPercent(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${formatNumber(rate * 100, digits)}%`;
}
