import { describe, expect, it } from "vitest";
import { buildUtmLink, parseUtm, slugifyUtm, UtmError } from "@/domain/utm";
import { compareGroups, costPer, wilson } from "@/domain/stats";

describe("UTM builder", () => {
  it("normalises values and keeps non-UTM parameters", () => {
    const l = buildUtmLink({ landingUrl: "https://backapp.example/start?ref=1&utm_source=old", source: "Instagram", medium: "Social", campaign: "Calm October", content: "ci_123ABC" });
    expect(l.fullUrl).toBe("https://backapp.example/start?ref=1&utm_source=instagram&utm_medium=social&utm_campaign=calm-october&utm_content=ci_123abc");
    expect(l.landingUrl).toBe("https://backapp.example/start?ref=1");
  });
  it("rejects bad URLs and empty values", () => {
    expect(() => buildUtmLink({ landingUrl: "notaurl", source: "a", medium: "b", campaign: "c", content: "d" })).toThrow(UtmError);
    expect(() => buildUtmLink({ landingUrl: "https://x.example", source: "!!!", medium: "b", campaign: "c", content: "d" })).toThrow(/utm_source/);
  });
  it("slugifies diacritics and parses UTM back", () => {
    expect(slugifyUtm("Café Été")).toBe("cafe-ete");
    expect(parseUtm("https://x.example/?utm_source=Threads&utm_content=ci_1")).toEqual({ utm_source: "threads", utm_content: "ci_1" });
  });
});

describe("statistics", () => {
  it("computes Wilson intervals", () => {
    const i = wilson(10, 100)!;
    expect(i.low).toBeCloseTo(0.0552, 3);
    expect(i.high).toBeCloseTo(0.1744, 3);
    expect(wilson(0, 0)).toBeNull();
  });
  it("says 'not enough data' below thresholds", () => {
    const r = compareGroups([
      { key: "a", label: "A", publications: 2, impressions: 5000, successes: 100 },
      { key: "b", label: "B", publications: 8, impressions: 9000, successes: 50 },
    ]);
    expect(r.verdict.kind).toBe("not_enough_data");
    expect(r.groups[0].insufficiencyReason).toMatch(/2 of 5 publications/);
  });
  it("declares no difference when intervals overlap and a leader when they do not", () => {
    expect(compareGroups([
      { key: "a", label: "A", publications: 6, impressions: 2000, successes: 42 },
      { key: "b", label: "B", publications: 6, impressions: 2000, successes: 38 },
    ]).verdict.kind).toBe("no_difference");
    const lead = compareGroups([
      { key: "a", label: "A", publications: 6, impressions: 5000, successes: 300 },
      { key: "b", label: "B", publications: 6, impressions: 5000, successes: 100 },
    ]).verdict;
    expect(lead).toMatchObject({ kind: "leader", key: "a" });
  });
  it("never reports a cost when spend or results are missing", () => {
    expect(costPer(null, 10)).toBeNull();
    expect(costPer(100, 0)).toBeNull();
    expect(costPer(100, 4)).toBe(25);
  });
});
