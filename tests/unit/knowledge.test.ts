import { describe, expect, it } from "vitest";
import { chunkJson, chunkMarkdown, chunkTranscript } from "@/domain/knowledge/chunker";
import { assignPseudonyms, classifyCourseFile, collectNames, decodeZipName, parseCourseFile, parseFrontmatter, pseudonymise } from "@/domain/knowledge/course";
import { parseCsv, parseNumber } from "@/domain/csv";

describe("chunker", () => {
  it("keeps heading paths and line ranges", () => {
    const md = "# Title\n\nIntro text.\n\n## Part A\n\nAlpha.\n\n### Detail\n\nBeta.\n";
    const c = chunkMarkdown(md);
    expect(c.map((x) => x.locator.heading_path)).toEqual([["Title"], ["Title", "Part A"], ["Title", "Part A", "Detail"]]);
    expect(c[1].locator).toMatchObject({ line_start: 5, line_end: 8 });
    expect(c[2].content).toContain("Beta.");
  });
  it("chunks transcripts by timestamp", () => {
    const c = chunkTranscript("**[00:01]** Hello there.\n\n**[01:07]** Second part.");
    expect(c[0].locator.timestamp).toBe("00:01");
    expect(c[0].content).toContain("[01:07] Second part.");
  });
  it("chunks JSON by top-level key", () => {
    expect(chunkJson('{"a":1,"b":{"c":2}}').map((c) => c.locator.json_path)).toEqual(["$.a", "$.b"]);
  });
});

describe("CSV", () => {
  it("parses quotes, newlines and semicolons", () => {
    const r = parseCsv('date;post_url;views\n2026-10-01;"https://x/1";"1 234"\n2026-10-02;"a ""quoted""\nline";5\n');
    expect(r.header).toEqual(["date", "post_url", "views"]);
    expect(r.rows[1][1]).toBe('a "quoted"\nline');
  });
  it("parses localised numbers", () => {
    expect(parseNumber("1 234")).toBe(1234);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("12,5%")).toBe(12.5);
    expect(parseNumber("—")).toBeNull();
  });
});

describe("course import", () => {
  it("decodes zip names and classifies files", () => {
    expect(decodeZipName("06-office-hours/#U043f#U0440.md")).toBe("06-office-hours/пр.md");
    expect(classifyCourseFile("06-office-hours/marketing-w1-oh-transcript-2026-09-26.md")).toBe("transcript");
    expect(classifyCourseFile("06-office-hours/marketing-w1-oh-chat-2026-09-26.md")).toBe("chat");
    expect(classifyCourseFile("03-x/marketing-w1-opening-материалы/guide.md")).toBe("material");
    expect(classifyCourseFile("AJTBD prompt.md")).toBe("ajtbd");
  });
  it("reads front-matter lists", () => {
    const { data, body } = parseFrontmatter('---\ntitle: "T"\nspeakers:\n  - Ann Lee\n  - Bob\n---\n# Body');
    expect(data).toEqual({ title: "T", speakers: ["Ann Lee", "Bob"] });
    expect(body).toBe("# Body");
  });
  it("pseudonymises participants but keeps speakers and staff", () => {
    const card = parseCourseFile("06/marketing-w2-oh-2026-10-03.md", '---\nid: marketing-w2-oh\nspeakers:\n  - Тоня Жукова\n---\n## Participant Insights\n\n- **Екатерина Грачёва:** asked a question.\n- **Тоня:** joined.\n');
    const chat = parseCourseFile("06/marketing-w2-oh-chat-2026-10-03.md", "00:09:37\tЛиса НЛ:\tпривет\n00:12:34\tOlya {AI Mindset}:\thttps://x\n");
    const idx = collectNames([card, chat]);
    expect([...idx.participants].sort()).toEqual(["Екатерина Грачёва", "Лиса НЛ"]);
    const assigned = assignPseudonyms("secret", idx.participants);
    const map = new Map([...assigned].map(([n, v]) => [n, v.pseudonym]));
    const out = pseudonymise(card.text + chat.text, map);
    expect(out).not.toMatch(/Грачёва|Лиса НЛ/);
    expect(out).toMatch(/Тоня Жукова/);
    expect(out).toMatch(/Olya \{AI Mindset\}/);
    expect(out).toMatch(/Participant-0[12]/);
    // Deterministic: same input, same pseudonyms.
    expect([...assignPseudonyms("secret", idx.participants).values()]).toEqual([...assigned.values()]);
  });
});

describe("front-matter with preamble", () => {
  it("reads front-matter after a short preamble line and keeps the preamble in the body", () => {
    const { data, body } = parseFrontmatter('**🎥 Запись:** https://x\n\n---\nid: s1\ntitle: "Session"\nspeakers:\n  - Рома Кумар\n---\n## Summary');
    expect(data).toMatchObject({ id: "s1", title: "Session", speakers: ["Рома Кумар"] });
    expect(body).toContain("Запись");
    expect(body).toContain("## Summary");
  });
  it("does not treat a markdown horizontal rule as front-matter", () => {
    expect(parseFrontmatter("# Title\n\n---\n\ntext\n\n---\n").data).toEqual({});
  });
});
