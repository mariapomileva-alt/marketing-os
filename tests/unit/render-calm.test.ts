import { describe, expect, it } from "vitest";
import { timeline, wrap } from "../../scripts/render-calm.mjs";

describe("calm renderer timing", () => {
  it("wraps lines for the screen", () => {
    expect(wrap("You are watching the river, and nothing is asked of you right now.")).toBe("You are watching the river,\nand nothing is asked of you\nright now.");
  });
  it("stretches pauses to fill the target length, but not endlessly", () => {
    const lines = Array.from({ length: 60 }, () => ({ text: "A line.", pause: 4 }));
    const t = timeline(lines, lines.map(() => 3), 10);
    expect(t.total).toBeGreaterThan(560);
    expect(t.total).toBeLessThan(640);
    const short = timeline(lines.slice(0, 5), [3, 3, 3, 3, 3], 10);
    expect(short.total).toBeLessThan(120); // never stretched more than 2.5x
    expect(t.items[1].start).toBeGreaterThan(t.items[0].end);
  });
});
