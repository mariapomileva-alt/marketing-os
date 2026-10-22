import { describe, expect, it } from "vitest";
import { checkVoice, classifyMessage, parseIsoDuration, safetyDraft, scoreVideo, similarity, type VideoCandidate } from "@/domain/youtube";

const settings = { queries: ["panic attack"], minDurationSeconds: 61, channelCooldownDays: 30 };
const now = new Date("2026-10-22T12:00:00Z");
const video = (over: Partial<VideoCandidate> = {}): VideoCandidate => ({
  videoId: "abc", title: "What to do during a panic attack: 3 grounding steps", description: "A calm explanation of the first minutes of panic.",
  channelId: "UC1", channelTitle: "Calm Therapist", publishedAt: "2026-10-20T10:00:00Z", language: "en", durationSeconds: 540, views: 1200,
  commentsDisabled: false, madeForKids: false, ...over,
});

describe("video filtering", () => {
  it("accepts a relevant video and explains why", () => {
    const v = scoreVideo(video(), settings, null, now);
    expect(v.eligible).toBe(true);
    expect(v.relevance).toBeGreaterThanOrEqual(40);
    expect(v.matchedKeywords).toContain("panic attack");
  });

  it("rejects off-topic videos", () => {
    const v = scoreVideo(video({ title: "My morning routine", description: "Coffee and journaling" }), settings, null, now);
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/Not clearly about panic/);
  });

  it.each([
    [{ durationSeconds: 45 }, /Shorts/],
    [{ commentsDisabled: true }, /comments are off/],
    [{ madeForKids: true }, /made for kids/],
    [{ description: "Panic attack and suicidal thoughts: my story" }, /crisis/],
    [{ title: "Panic attack? Try CBD gummies" }, /drugs/],
    [{ description: "Cure panic attacks forever in 7 days" }, /sensational/],
    [{ title: "Panic attacks explained for kids" }, /children/],
  ])("skips relevant but unsuitable videos %#", (over, why) => {
    const v = scoreVideo(video(over), settings, null, now);
    expect(v.eligible).toBe(false);
    expect(v.flags.join(" ")).toMatch(why);
  });

  it("respects the 30-day channel cooldown", () => {
    const recent = scoreVideo(video(), settings, new Date("2026-10-10T00:00:00Z"), now);
    expect(recent.eligible).toBe(false);
    const old = scoreVideo(video(), settings, new Date("2026-09-01T00:00:00Z"), now);
    expect(old.eligible).toBe(true);
  });

  it("works for Russian titles", () => {
    expect(scoreVideo(video({ title: "Что делать при панической атаке", description: "" }), settings, null, now).eligible).toBe(true);
  });

  it("parses YouTube durations", () => {
    expect(parseIsoDuration("PT9M5S")).toBe(545);
    expect(parseIsoDuration("PT1H")).toBe(3600);
    expect(parseIsoDuration("P0D")).toBe(0);
    expect(parseIsoDuration(null)).toBeNull();
  });
});

describe("message risk", () => {
  it.each([
    ["I don't want to live like this anymore", "high"],
    ["chest pain and I think I'm passing out", "high"],
    ["Я не хочу жить", "high"],
    ["nothing helps, I can't leave the house", "high"],
  ])("escalates %s", (text, risk) => {
    expect(classifyMessage(text).risk).toBe(risk);
  });

  it("recognises ordinary messages", () => {
    expect(classifyMessage("What is this app called?").kind).toBe("question_about_back");
    expect(classifyMessage("Another app that promises to cure anxiety?").kind).toBe("criticism");
    expect(classifyMessage("Thank you, this was helpful").kind).toBe("thanks");
  });

  it("safety drafts never mention the product", () => {
    expect(safetyDraft("en")).not.toMatch(/\bBack\b/);
    expect(safetyDraft("ru")).not.toMatch(/\bBack\b/);
    expect(safetyDraft("en")).toMatch(/emergency/);
  });
});

describe("human voice and repetition", () => {
  const earlier = [
    "That point about the first minutes really lands. When everything feels urgent, long instructions are hard to follow. I'm on the team that makes Back, and we keep steps short for exactly that reason.",
  ];

  it("passes a specific, open comment", () => {
    const r = checkVoice("Thank you for saying out loud that breathing exercises can feel like pressure. Starting with something outside the body, like your feet on the floor, is such a gentle alternative.", earlier);
    expect(r.ok).toBe(true);
    expect(r.mentionsProduct).toBe(false);
  });

  it("detects near-copies of earlier comments", () => {
    const copy = earlier[0].replace("really lands", "really matters");
    const r = checkVoice(copy, earlier);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/overlap|Starts the same way/);
    expect(similarity(copy, earlier[0])).toBeGreaterThan(0.35);
  });

  it("requires disclosure when the product is mentioned", () => {
    expect(checkVoice("Back has short steps for the first minutes of panic, worth a look.", []).problems.join(" ")).toMatch(/without saying we are the team/);
    expect(checkVoice("We're building Back, a small tool with short steps for the first minutes. Thank you for this calm explanation.", []).ok).toBe(true);
  });

  it("rejects invented experience, medical promises and sales language", () => {
    expect(checkVoice("I had panic attacks for years and Back saved me. I'm on the team that makes Back.", []).ok).toBe(false);
    expect(checkVoice("We're building Back and it stops panic attacks.", []).ok).toBe(false);
    expect(checkVoice("Great video! Download Back, the best app for this.", []).ok).toBe(false);
  });

  it("does not mistake ordinary English for the product name", () => {
    expect(checkVoice("Back then I didn't know any of this, and that's okay. Thank you for explaining it so gently.", []).mentionsProduct).toBe(false);
  });
});
