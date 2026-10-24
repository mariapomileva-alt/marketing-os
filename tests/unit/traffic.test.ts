import { describe, expect, it } from "vitest";
import { appStoreCampaignUrl, classifySource, deviceOf, isBot, taggedUrl } from "@/domain/traffic";

const IG_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";
const THREADS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Barcelona 350.0.0.0";

describe("traffic source", () => {
  it("prefers our own UTM tags", () => {
    expect(classifySource({ utmSource: "instagram", referrer: "https://www.google.com/" }).source).toBe("instagram");
    expect(classifySource({ utmSource: "yt" }).source).toBe("youtube");
    expect(classifySource({ utmSource: "partner-site" }).source).toBe("other");
  });
  it("recognises in-app browsers without a referrer", () => {
    expect(classifySource({ userAgent: IG_UA }).source).toBe("instagram");
    expect(classifySource({ userAgent: THREADS_UA }).source).toBe("threads");
  });
  it("uses the referrer host", () => {
    expect(classifySource({ referrer: "https://m.youtube.com/watch?v=x" }).source).toBe("youtube");
    expect(classifySource({ referrer: "https://l.instagram.com/?u=x" }).source).toBe("instagram");
    expect(classifySource({ referrer: "https://www.google.de/" }).source).toBe("google");
    expect(classifySource({ referrer: "https://t.co/abc" }).source).toBe("x");
    expect(classifySource({ referrer: "https://someblog.example/post" })).toEqual({ source: "other", referrerHost: "someblog.example" });
  });
  it("treats moves within our own site and no referrer as direct", () => {
    expect(classifySource({ referrer: "https://backapp.live/faq", ownHost: "www.backapp.live" }).source).toBe("direct");
    expect(classifySource({}).source).toBe("direct");
  });
  it("detects devices and bots", () => {
    expect(deviceOf(IG_UA)).toBe("mobile");
    expect(isBot("Googlebot/2.1")).toBe(true);
    expect(isBot(IG_UA)).toBe(false);
  });
  it("builds tagged links", () => {
    expect(taggedUrl("https://backapp.live/", { source: "instagram", medium: "bio", key: "instagram_bio" })).toBe("https://backapp.live/?utm_source=instagram&utm_medium=bio&utm_campaign=instagram_bio");
    expect(appStoreCampaignUrl("https://apps.apple.com/app/id6811918141", "123456", "youtube_channel")).toBe("https://apps.apple.com/app/id6811918141?pt=123456&ct=youtube_channel&mt=8");
  });
});

describe("AI assistants and app referrers", () => {
  const src = (i: Parameters<typeof classifySource>[0]) => classifySource(i).source;
  it("recognises AI assistants by referrer and by tag", () => {
    expect(src({ referrer: "https://chatgpt.com/" })).toBe("chatgpt");
    expect(src({ utmSource: "chatgpt.com" })).toBe("chatgpt");
    expect(src({ referrer: "https://www.perplexity.ai/search?q=x" })).toBe("perplexity");
    expect(src({ referrer: "https://gemini.google.com/app" })).toBe("gemini");
    expect(src({ referrer: "https://www.google.com/" })).toBe("google");
    expect(src({ referrer: "https://claude.ai/chat/1" })).toBe("claude");
    expect(src({ referrer: "https://copilot.microsoft.com/" })).toBe("copilot");
    expect(src({ referrer: "https://chat.deepseek.com/" })).toBe("deepseek");
  });
  it("recognises android app referrers and in-app browsers", () => {
    expect(src({ referrer: "android-app://com.whatsapp/" })).toBe("whatsapp");
    expect(src({ referrer: "android-app://org.telegram.messenger/" })).toBe("telegram");
    expect(src({ referrer: "android-app://com.google.android.gm/" })).toBe("email");
    expect(src({ userAgent: "Mozilla/5.0 (iPhone) [LinkedInApp]" })).toBe("linkedin");
    expect(src({ referrer: "https://duckduckgo.com/" })).toBe("duckduckgo");
  });
});
