import { describe, expect, it } from "vitest";
import { spacePath } from "@/proxy";

const req = (url: string) => ({ nextUrl: new URL(url, "https://x.app") }) as never;
const state = (slug: string) => `${Buffer.from(JSON.stringify({ productId: "p", slug, nonce: "n", t: 1 })).toString("base64url")}.mac`;

describe("spacePath", () => {
  it("keeps normal paths", () => expect(spacePath(req("/p/back-app/calm"))).toBe("/p/back-app/calm"));
  it("uses ?product on an OAuth start", () => expect(spacePath(req("/api/instagram/oauth/start?product=back-app"))).toBe("/p/back-app"));
  it("reads the slug from the state on a callback", () =>
    expect(spacePath(req(`/api/youtube/oauth/callback?code=1&state=${state("momentro")}`))).toBe("/p/momentro"));
  it("ignores a broken state", () => expect(spacePath(req("/api/threads/oauth/callback?state=%%%"))).toBe("/api/threads/oauth/callback"));
});
