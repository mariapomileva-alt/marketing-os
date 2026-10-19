/**
 * Splits documents into chunks with locators so every search hit and every citation can point to
 * the exact place in the original (heading path + line range, timestamp, JSON path or CSV row).
 */
export interface Chunk {
  ordinal: number;
  content: string;
  locator: {
    heading_path?: string[];
    line_start?: number;
    line_end?: number;
    timestamp?: string;
    json_path?: string;
    row?: number;
  };
}

const MAX_CHARS = 1400;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Block {
  text: string;
  lineStart: number;
  lineEnd: number;
  headingPath: string[];
}

/** Markdown: blocks under each heading, merged up to MAX_CHARS, never across headings. */
export function chunkMarkdown(md: string): Chunk[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const path: string[] = [];
  let buf: string[] = [];
  let start = 1;
  let inFence = false;
  const flush = (endLine: number) => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ text, lineStart: start, lineEnd: endLine, headingPath: [...path] });
    buf = [];
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence ? /^(#{1,6})\s+(.*)$/.exec(line) : null;
    if (h) {
      flush(n - 1);
      const level = h[1].length;
      path.splice(level - 1);
      path[level - 1] = h[2].trim();
      for (let k = 0; k < level - 1; k++) if (path[k] === undefined) path[k] = "";
      start = n;
      buf.push(line);
      return;
    }
    if (!inFence && line.trim() === "" && buf.join("").length > MAX_CHARS) {
      flush(n - 1);
      start = n + 1;
      return;
    }
    if (buf.length === 0) start = n;
    buf.push(line);
  });
  flush(lines.length);
  return mergeBlocks(blocks);
}

function mergeBlocks(blocks: Block[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Block | null = null;
  const push = (b: Block) =>
    chunks.push({
      ordinal: chunks.length,
      content: b.text,
      locator: { heading_path: b.headingPath.filter(Boolean), line_start: b.lineStart, line_end: b.lineEnd },
    });
  for (const b of blocks) {
    for (const piece of splitLong(b)) {
      if (cur && cur.headingPath.join("/") === piece.headingPath.join("/") && cur.text.length + piece.text.length + 2 <= MAX_CHARS) {
        cur = { ...cur, text: `${cur.text}\n\n${piece.text}`, lineEnd: piece.lineEnd };
      } else {
        if (cur) push(cur);
        cur = piece;
      }
    }
  }
  if (cur) push(cur);
  return chunks;
}

function splitLong(b: Block): Block[] {
  if (b.text.length <= MAX_CHARS * 1.5) return [b];
  const out: Block[] = [];
  const sentences = b.text.split(/(?<=[.!?…])\s+/u);
  let acc = "";
  for (const s of sentences) {
    if (acc && acc.length + s.length + 1 > MAX_CHARS) {
      out.push({ ...b, text: acc });
      acc = s;
    } else acc = acc ? `${acc} ${s}` : s;
  }
  if (acc) out.push({ ...b, text: acc });
  return out;
}

export function chunkPlainText(text: string): Chunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buf: string[] = [];
  let start = 1;
  lines.forEach((line, i) => {
    if (line.trim() === "") {
      if (buf.length) blocks.push({ text: buf.join("\n").trim(), lineStart: start, lineEnd: i, headingPath: [] });
      buf = [];
      start = i + 2;
    } else buf.push(line);
  });
  if (buf.length) blocks.push({ text: buf.join("\n").trim(), lineStart: start, lineEnd: lines.length, headingPath: [] });
  return mergeBlocks(blocks);
}

/** Transcripts with **[mm:ss]** markers: chunks keep the first timestamp as locator. */
export function chunkTranscript(md: string): Chunk[] {
  const re = /\*\*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\*\*\s*/g;
  const parts: { ts: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  let last: { ts: string; idx: number } | null = null;
  while ((m = re.exec(md))) {
    if (last) parts.push({ ts: last.ts, text: md.slice(last.idx, m.index).trim() });
    last = { ts: m[1], idx: m.index + m[0].length };
  }
  if (last) parts.push({ ts: last.ts, text: md.slice(last.idx).trim() });
  if (!parts.length) return chunkMarkdown(md);
  const chunks: Chunk[] = [];
  let acc = "";
  let ts = parts[0].ts;
  for (const p of parts) {
    if (acc && acc.length + p.text.length > MAX_CHARS) {
      chunks.push({ ordinal: chunks.length, content: acc, locator: { timestamp: ts } });
      acc = "";
      ts = p.ts;
    }
    acc = acc ? `${acc}\n[${p.ts}] ${p.text}` : `[${p.ts}] ${p.text}`;
  }
  if (acc) chunks.push({ ordinal: chunks.length, content: acc, locator: { timestamp: ts } });
  return chunks;
}

/** JSON: one chunk per top-level key or array item (pretty-printed), with a JSON path locator. */
export function chunkJson(text: string): Chunk[] {
  const data = JSON.parse(text) as unknown;
  const chunks: Chunk[] = [];
  const add = (path: string, value: unknown) => {
    const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    for (let i = 0; i < body.length; i += MAX_CHARS * 2) {
      chunks.push({ ordinal: chunks.length, content: `${path}\n${body.slice(i, i + MAX_CHARS * 2)}`, locator: { json_path: path } });
    }
  };
  if (Array.isArray(data)) data.forEach((v, i) => add(`$[${i}]`, v));
  else if (data && typeof data === "object") Object.entries(data).forEach(([k, v]) => add(`$.${k}`, v));
  else add("$", data);
  return chunks;
}

/** CSV: one chunk per row rendered as "column: value" lines, so rows are searchable and citable. */
export function chunkCsvRows(header: string[], rows: string[][]): Chunk[] {
  return rows.map((r, i) => ({
    ordinal: i,
    content: header.map((h, j) => `${h}: ${r[j] ?? ""}`).join("\n"),
    locator: { row: i + 2 },
  }));
}
