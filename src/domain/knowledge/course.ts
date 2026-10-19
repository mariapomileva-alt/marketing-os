/**
 * Course-vault import logic (AI Mindset Marketing Sprint export and the AJTBD files).
 * Pure functions: classify files, read front-matter into provenance, and pseudonymise participants.
 * Lecturers, guest speakers and course staff stay named (they are the authors); other participants
 * are replaced with stable pseudonyms. Real names are never stored: only an HMAC of each name.
 */
import { createHmac } from "node:crypto";

export type CourseFileKind = "card" | "transcript" | "chat" | "material" | "programme" | "readme" | "pdf" | "ajtbd" | "other";

export interface CourseFile {
  path: string; // decoded, relative to the vault root
  bytes: Uint8Array;
}

export interface ParsedCourseFile {
  path: string;
  kind: CourseFileKind;
  title: string;
  section: string | null;
  sessionId: string | null;
  date: string | null;
  speakers: string[];
  author: string | null;
  text: string;
  frontmatter: Record<string, unknown>;
}

/** Zip tools that do not use UTF-8 flags encode non-ASCII names as #UXXXX. */
export function decodeZipName(name: string): string {
  return name.replace(/#U([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export function classifyCourseFile(path: string): CourseFileKind {
  const base = path.split("/").pop() ?? path;
  const lower = base.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/ajtbd|schema-call-record|codebook-template/i.test(base)) return "ajtbd";
  if (!lower.endsWith(".md") && !lower.endsWith(".json")) return "other";
  if (lower === "readme.md") return "readme";
  if (base === "программа.md") return "programme";
  if (/-transcript-\d{4}-\d{2}-\d{2}\.md$/.test(base)) return "transcript";
  if (/-chat-\d{4}-\d{2}-\d{2}\.md$/.test(base)) return "chat";
  if (/материалы\//.test(path)) return "material";
  return "card";
}

/** Minimal YAML front-matter reader: `key: value` and `key:` followed by `  - item` lists. */
export function parseFrontmatter(md: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { data: {}, body: md };
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2] === "") {
      listKey = kv[1];
      data[listKey] = [];
    } else {
      listKey = null;
      data[kv[1]] = unquote(kv[2]);
    }
  }
  return { data, body: md.slice(m[0].length) };
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

export function parseCourseFile(path: string, text: string): ParsedCourseFile {
  const kind = classifyCourseFile(path);
  const { data, body } = kind === "pdf" ? { data: {}, body: "" } : parseFrontmatter(text);
  const segments = path.split("/");
  const section = segments.length > 2 ? segments[segments.length - 2].replace(/-материалы$/, "") : null;
  const base = segments[segments.length - 1];
  const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(base);
  const sessionMatch = /^(marketing-[a-z0-9-]+?)(?:-(?:transcript|chat|workshop|lecture|guest|prework))?-\d{4}-\d{2}-\d{2}\.md$/.exec(base);
  const speakers = Array.isArray(data.speakers) ? (data.speakers as string[]) : typeof data.speaker === "string" ? [data.speaker] : [];
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return {
    path,
    kind,
    title: (typeof data.title === "string" && data.title) || h1 || base.replace(/\.(md|json|pdf)$/i, ""),
    section,
    sessionId: (typeof data.id === "string" && data.id) || sessionMatch?.[1] || null,
    date: (typeof data.date === "string" && data.date) || dateMatch?.[1] || null,
    speakers,
    author: speakers.length ? speakers.join(", ") : null,
    text: kind === "pdf" ? "" : text,
    frontmatter: data,
  };
}

/** Course staff in chats are tagged like "Olya {AI Mindset}". */
const STAFF_TAG = /\{AI Mindset\}/i;

export interface NameIndex {
  keep: Set<string>; // names that stay as they are (speakers, staff)
  participants: Set<string>; // names to pseudonymise
}

export function collectNames(files: ParsedCourseFile[]): NameIndex {
  const keep = new Set<string>();
  const participants = new Set<string>();
  for (const f of files) for (const s of f.speakers) keep.add(s.trim());
  for (const f of files) {
    if (f.kind === "chat") {
      for (const line of f.text.split(/\r?\n/)) {
        const m = /^\d{1,2}:\d{2}:\d{2}\t([^\t]+?):\t/.exec(line);
        if (!m) continue;
        const name = m[1].trim();
        if (STAFF_TAG.test(name)) keep.add(name);
        else participants.add(name);
      }
    }
    if (f.kind === "card") {
      const section = /## Participant Insights\s*\n([\s\S]*?)(\n## |\s*$)/.exec(f.text)?.[1] ?? "";
      for (const m of section.matchAll(/^- \*\*(.+?):\*\*/gm)) participants.add(m[1].trim());
    }
  }
  for (const k of keep) participants.delete(k);
  // A participant entry that is only the first name of a speaker ("Тоня") is a speaker, keep it.
  const speakerFirstNames = new Set([...keep].map((k) => k.split(/\s+/)[0]));
  for (const p of [...participants]) if (speakerFirstNames.has(p)) participants.delete(p);
  return { keep, participants };
}

export function nameHmac(secret: string, name: string): string {
  return createHmac("sha256", secret).update(name.normalize("NFC").toLowerCase()).digest("hex");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces participant names with pseudonyms. Longer names first so "Екатерина Грачёва" is replaced
 * before "Екатерина". Word boundaries are unicode-aware.
 */
export function pseudonymise(text: string, map: Map<string, string>): string {
  const names = [...map.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const name of names) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, "gu");
    out = out.replace(re, map.get(name)!);
  }
  return out;
}

/** Deterministic pseudonym assignment: sorted by HMAC so the order does not reveal names. */
export function assignPseudonyms(secret: string, names: Iterable<string>, existing: Map<string, string> = new Map()): Map<string, { hmac: string; pseudonym: string }> {
  const used = new Set(existing.values());
  let next = used.size + 1;
  const out = new Map<string, { hmac: string; pseudonym: string }>();
  const list = [...new Set(names)].map((n) => ({ n, h: nameHmac(secret, n) })).sort((a, b) => a.h.localeCompare(b.h));
  for (const { n, h } of list) {
    let p = existing.get(h);
    if (!p) {
      do p = `Participant-${String(next++).padStart(2, "0")}`;
      while (used.has(p));
      used.add(p);
    }
    out.set(n, { hmac: h, pseudonym: p });
  }
  return out;
}
