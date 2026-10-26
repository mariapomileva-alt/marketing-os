import { describe, expect, it } from "vitest";
import { checkVoice, styleNotes, classifyMessage, parseIsoDuration, safetyDraft, scoreVideo, similarity, type VideoCandidate } from "@/domain/youtube";

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

describe("bot-like phrasing", () => {
  it.each(["Great point! This resonates so much.", "I appreciate you sharing this.", "It's important to remember you are not alone on this journey."])("flags %s", (t) => {
    expect(checkVoice(t, []).problems.join(" ")).toMatch(/bot/);
  });
  it("flags hashtags", () => {
    expect(checkVoice("Breathing slowly really helps here #anxiety #panic", []).ok).toBe(false);
  });
});

describe("query rotation", () => {
  it("uses every phrase when the list is short and a moving window when it is long", async () => {
    const { queriesForRun } = await import("@/domain/youtube");
    const q = Array.from({ length: 40 }, (_, i) => `q${i}`);
    expect(queriesForRun(q.slice(0, 5), 15)).toHaveLength(5);
    const d1 = queriesForRun(q, 15, new Date("2026-10-23T06:00:00Z"));
    const d2 = queriesForRun(q, 15, new Date("2026-10-24T06:00:00Z"));
    expect(d1).toHaveLength(15);
    expect(d2[0]).not.toBe(d1[0]);
    const covered = new Set([0, 1, 2].flatMap((i) => queriesForRun(q, 15, new Date(Date.UTC(2026, 9, 23 + i)))));
    expect(covered.size).toBe(40); // three days cover the whole list
  });
});

describe("breaking the team's habits", () => {
  const habit = [
    "The one-breath idea works because it is so small. Does anyone else find it easier after the first one?",
    "The playlist turning into a trigger is a sneaky one. Has anyone here had a calming thing flip like that?",
    "That 'no need to explain' line is the kindest part. Does anyone else find breathing easier once they stop trying?",
    "Putting the GP check in its own chapter matters. Did anyone else find the waiting harder than the visit?",
  ];

  it("counts what recent comments keep doing and says what to change", () => {
    const notes = styleNotes(habit, "comments").join(" ");
    expect(notes).toMatch(/4 of the last 4 comments ended with a question/);
    expect(notes).toMatch(/does anyone else/);
    expect(styleNotes(habit.slice(0, 2))).toEqual([]);
  });

  it("stops another 'does anyone else' and another closing question", () => {
    const r = checkVoice("Night panic has its own rules. Does anyone else feel it worse after midnight?", habit);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/does anyone else/);
    expect(r.problems.join(" ")).toMatch(/question again/);
    expect(checkVoice("Naming three sounds in the room is small enough to remember when your head is loud. The fridge counts.", habit).ok).toBe(true);
  });

  it("warns about the 'not X, it's Y' turn", () => {
    expect(checkVoice("This isn't about willpower, it's about giving your body a minute.", []).warnings.join(" ")).toMatch(/not X/);
    expect(checkVoice("What does panic say at 3am?\n\nNot the polished version. The actual sentence in your head.", []).warnings.join(" ")).toMatch(/not X/);
  });
});
