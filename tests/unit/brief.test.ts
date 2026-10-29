import { describe, expect, it } from "vitest";
import { PROMPTS } from "@/domain/ai/prompts";
import { BACK_BRIEF, defaultBrief, fillPrompt, mergeBrief } from "@/domain/brief";
import { MOMENTRO_BRIEF } from "@/domain/seed/momentro";

describe("marketing brief fills every prompt", () => {
  const momentro = mergeBrief(defaultBrief({ name: "Momentro", short_description: "Desktop app", category: "Video" }), MOMENTRO_BRIEF);
  it("leaves no placeholder unfilled, for Back and for Momentro", () => {
    for (const p of PROMPTS) {
      expect(fillPrompt(p.system, BACK_BRIEF), p.key).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(fillPrompt(p.system, momentro), p.key).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });
  it("Momentro's desk and Threads prompts speak about Momentro, not panic or Back", () => {
    for (const key of ["content_desk.v1", "threads_posts.v1", "community_comment.v2", "community_social_comment.v1", "morning_brief.v1"]) {
      const text = fillPrompt(PROMPTS.find((p) => p.key === key)!.system, momentro);
      expect(text, key).toMatch(/Momentro/);
      expect(text, key).not.toMatch(/panic attack/i);
      expect(text, key).not.toMatch(/\bBack\b(?! to| from)/); // the brand name, not the English word
    }
  });
  it("Back keeps its own voice and safety lines", () => {
    const desk = fillPrompt(PROMPTS.find((p) => p.key === "content_desk.v1")!.system, BACK_BRIEF);
    expect(desk).toMatch(/Back panic app/);
    expect(desk).toMatch(/112 in the EU, 911 in the US, 999 in the UK/);
  });
});
