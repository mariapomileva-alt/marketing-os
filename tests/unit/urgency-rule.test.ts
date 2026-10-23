import { describe, expect, it } from "vitest";
import { checkText, outcomeOf } from "@/domain/guardrails";
import { BACK_APP_GUARDRAILS } from "@/domain/seed/back-app";

const blocked = (text: string) => outcomeOf(checkText({ text, channel: "youtube", format: "helpful_comment" }, BACK_APP_GUARDRAILS)) === "block";

describe("false urgency rule", () => {
  it("lets calm, negated phrases through", () => {
    expect(blocked("There is no hurry to leave this.")).toBe(false);
    expect(blocked("You are not in a hurry.")).toBe(false);
    expect(blocked("There's no need to hurry.")).toBe(false);
  });
  it("still blocks pressure", () => {
    expect(blocked("Hurry, download Back today.")).toBe(true);
    expect(blocked("Last chance to try it.")).toBe(true);
  });
});
