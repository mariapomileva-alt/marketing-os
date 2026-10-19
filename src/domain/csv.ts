/** RFC 4180 CSV parser (quotes, escaped quotes, newlines in quoted fields). Detects , ; or tab. */
export function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(input: string, delimiter?: string): { header: string[]; rows: string[][] } {
  const text = input.replace(/^﻿/, "");
  const d = delimiter ?? detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") inQuotes = true;
    else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (inQuotes) throw new Error("CSV has an unterminated quoted field");
  if (field !== "" || row.length) {
    row.push(field);
    out.push(row);
  }
  const nonEmpty = out.filter((r) => r.some((c) => c.trim() !== ""));
  const [header = [], ...rows] = nonEmpty;
  return { header: header.map((h) => h.trim()), rows };
}

/** Parses numbers written as "1 234,5", "1,234.5", "12%". Returns null for blanks/unparseable. */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim().replace(/[%\s ]/g, "").replace(/[€$£]/g, "");
  if (!s || s === "-" || s === "—") return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
