import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { renderPost } from "@/server/cards/render";

describe("brand cards", () => {
  it("renders a carousel as 1080x1350 JPEGs", async () => {
    const imgs = await renderPost("carousel", [
      { title: "Panic at 3am has its own rules", text: "" },
      { title: "Your body is loud, not broken", text: "A racing heart in panic is an alarm, not a verdict. Alarms are loud on purpose." },
      { title: "Give your eyes one job", text: "Find three things that are blue. Slowly. The fridge counts." },
      { title: "Back panic app", text: "Help for the first minute. One tap, no account, works offline." },
    ]);
    expect(imgs).toHaveLength(4);
    for (const [i, img] of imgs.entries()) {
      const m = await sharp(Buffer.from(img)).metadata();
      expect(m).toMatchObject({ format: "jpeg", width: 1080, height: 1350 });
      if (process.env.CARDS_OUT) writeFileSync(`${process.env.CARDS_OUT}/slide-${i + 1}.jpg`, img);
    }
    const single = await renderPost("static_concept", [{ title: "You don't have to fix the whole night. The next small choice is enough.", text: "" }]);
    if (process.env.CARDS_OUT) writeFileSync(`${process.env.CARDS_OUT}/single.jpg`, single[0]);
  }, 60_000);
});
