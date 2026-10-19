import { describe, expect, it } from "vitest";
import { checkText, flattenBody, outcomeOf } from "@/domain/guardrails";
import { BACK_APP_GUARDRAILS } from "@/domain/seed/back-app";

const check = (text: string, channel = "instagram", format = "caption") => checkText({ text, channel, format }, BACK_APP_GUARDRAILS);
const codes = (text: string) => check(text).map((f) => f.code);

// Golden set: Back App red lines from the brief §6 must ALWAYS be caught.
describe("Back App golden set — must block", () => {
  it.each([
    ["Back App will cure your panic attacks.", "backapp.no_cure_promise"],
    ["Never have a panic attack again.", "backapp.no_cure_promise"],
    ["Get rid of anxiety forever with one tap.", "backapp.no_cure_promise"],
    ["Это приложение вылечит панические атаки.", "backapp.no_cure_promise"],
    ["You probably have panic disorder.", "backapp.no_diagnosis"],
    ["We diagnose what is happening to you.", "backapp.no_diagnosis"],
    ["У вас паническое расстройство.", "backapp.no_diagnosis"],
    ["Use Back App instead of therapy.", "backapp.no_replacement_of_professionals"],
    ["You don't need a therapist anymore.", "backapp.no_replacement_of_professionals"],
    ["Только сегодня — успей скачать!", "backapp.no_false_urgency"],
    ["Last chance: act now.", "backapp.no_false_urgency"],
    ["Download it before it's too late.", "backapp.no_fear_manipulation"],
    ["Guaranteed calm in 60 seconds.", "backapp.no_guarantees"],
    ["As a long-time user of this app, I can say it works.", "global.no_customer_impersonation"],
    ["This app saved my life.", "global.no_customer_impersonation"],
    ["If you have thoughts of suicide, try our breathing tool.", "backapp.crisis_safety_line"],
  ])("%s", (text, code) => {
    expect(codes(text)).toContain(code);
    expect(outcomeOf(check(text))).toBe("block");
  });
});

describe("Back App golden set — must allow", () => {
  it.each([
    "Back App is not a cure and does not diagnose. It is support for the moment you are in.",
    "Back App does not replace a doctor, therapist or emergency services.",
    "Your body is loud right now. That is not the same as danger. Try one slow breath with us.",
    "If you have thoughts of suicide, please call 112 or your local emergency number right now.",
    "Приложение не лечит и не ставит диагноз. Это поддержка в моменте.",
  ])("%s", (text) => {
    expect(outcomeOf(check(text))).not.toBe("block");
  });
});

describe("format and link checks", () => {
  it("blocks Threads posts over 500 characters", () => {
    const f = checkText({ text: "a".repeat(501), channel: "threads", format: "short_post" }, []);
    expect(f.map((x) => x.code)).toContain("format.too_long");
  });
  it("blocks links to unknown hosts and warns on missing UTM", () => {
    const f = checkText({ text: "See https://evil.example/x and https://backapp.example/page", channel: "threads", format: "short_post", allowedHosts: ["backapp.example"] }, []);
    expect(f.map((x) => x.code)).toEqual(expect.arrayContaining(["links.unknown_host", "links.missing_utm"]));
  });
  it("flattens nested bodies", () => {
    expect(flattenBody({ caption: "a", slides: [{ title: "b", text: "c" }] })).toBe("a\nb\nc");
  });
});
