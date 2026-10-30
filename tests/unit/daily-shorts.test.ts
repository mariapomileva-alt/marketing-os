import { describe, expect, it } from "vitest";
import { nextShortSlot, pickSpread, splitLanes } from "@/server/services/calm-shorts";
import { planMix } from "@/server/services/shorts-mix";

describe("daily shorts plan", () => {
  it("takes six pieces spread over the whole video", () => {
    const g = Array.from({ length: 12 }, (_, i) => i);
    expect(pickSpread(g, 6)).toEqual([0, 2, 4, 7, 9, 11]);
    expect(pickSpread([1, 2], 6)).toEqual([1, 2]);
  });

  it("splits pieces half to YouTube, half to Instagram + TikTok", () => {
    const lanes = splitLanes(6);
    expect(lanes.filter((l) => l === "youtube")).toHaveLength(3);
    expect(lanes.filter((l) => l === "social")).toHaveLength(3);
  });

  it("fills three times a day, skipping taken times and times too close", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const slots = ["06:30", "11:30", "17:30"];
    expect(nextShortSlot(slots, [], now).toISOString()).toBe("2026-11-01T17:30:00.000Z"); // 11:30 is too close
    const taken = [new Date("2026-11-01T17:30:00Z")];
    expect(nextShortSlot(slots, taken, now).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });

  it("mixes each platform on its own: no lane gets two shorts at one time", () => {
    const at = (d: number, h: number) => new Date(Date.UTC(2026, 10, d, h, 30));
    const items = [1, 2, 3].flatMap((d) => [6, 11, 17].flatMap((h, k) => [
      { key: `y${d}${h}`, family: `calm:v${(d + k) % 3}`, at: at(d, h), label: "", lane: "youtube" },
    ]));
    const plan = planMix(items, 3);
    const times = plan.moves.map((m) => m.to.getTime());
    expect(new Set(times).size).toBe(times.length);
  });
});
