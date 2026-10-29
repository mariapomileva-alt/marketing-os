import { describe, expect, it } from "vitest";
import { planMix, type MixItem } from "@/server/services/shorts-mix";

const at = (day: number, h: number) => new Date(Date.UTC(2030, 4, 1 + day, h - 3, 0)); // Riga is UTC+3 in May
const fams = (moves: Array<{ item: MixItem; to: Date }>) => moves.sort((a, b) => a.to.getTime() - b.to.getTime()).map((m) => m.item.family);

describe("mixing shorts by look", () => {
  // 8 days, 3 shorts a day (11:00, 18:00, 19:00): own videos at 11 and 19, calm shorts at 18 one long video after another.
  const items: MixItem[] = [];
  for (let d = 0; d < 8; d++) {
    items.push({ key: `own${d}a`, family: "own", at: at(d, 11), label: "" }, { key: `own${d}b`, family: "own", at: at(d, 19), label: "" });
    items.push({ key: `c${d}`, family: d < 3 ? "calm:A" : d < 6 ? "calm:B" : "calm:C", at: at(d, 18), label: "" });
  }

  it("keeps the same times and only swaps which short goes when", () => {
    const { moves } = planMix(items, 7);
    expect(moves.map((m) => m.to.getTime()).sort()).toEqual(items.map((i) => i.at.getTime()).sort());
    expect(new Set(moves.map((m) => m.item.key)).size).toBe(items.length);
  });

  it("spreads one look out: a long video's shorts never on the same or the next day", () => {
    const r = planMix(items, 7);
    expect(r.cost).toBeLessThan(r.before);
    const seq = fams(r.moves);
    const dayOf = new Map<string, number[]>();
    seq.forEach((f, i) => dayOf.set(f, [...(dayOf.get(f) ?? []), Math.floor(i / 3)]));
    for (const f of ["calm:A", "calm:B", "calm:C"]) {
      const ds = dayOf.get(f)!;
      for (let k = 1; k < ds.length; k++) expect(ds[k] - ds[k - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the order inside one look (part 1 before part 2)", () => {
    const r = planMix(items, 3);
    const a = r.moves.filter((m) => m.item.family === "calm:A").sort((x, y) => x.to.getTime() - y.to.getTime()).map((m) => m.item.key);
    expect(a).toEqual(["c0", "c1", "c2"]);
  });
});
