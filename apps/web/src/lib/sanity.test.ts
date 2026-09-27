import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapHomepage, sanityConfig } from "./sanity";
import { verifySanitySignature } from "./sanity-webhook";

describe("Sanity homepage mapping", () => {
  it("is off unless a valid project id is set", () => {
    expect(sanityConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(sanityConfig({ SANITY_PROJECT_ID: "bad id!" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(sanityConfig({ SANITY_PROJECT_ID: "abc123" } as unknown as NodeJS.ProcessEnv)).toEqual({ projectId: "abc123", dataset: "production", token: null });
  });

  it("maps filled fields and drops empty ones so they never blank the page", () => {
    const m = mapHomepage({
      hero: { mainHeadingStart: "Hello", description: "  ", ticks: ["One", "", "Two"] },
      faqs: [{ _key: "a", q: "Q1", a: "A1" }, { _key: "b", q: "No answer" }],
      featureGroups: [{ _key: "x", title: "Network", body: "b", icon: "router", bullets: ["x"] }, { title: "No bullets" }],
      customerPoints: [{ title: "App", icon: "not-an-icon" }],
      pricing: { starterMonthly: 4000, growthMonthly: -5 },
      steps: [],
    })!;
    expect(m.content.hero).toEqual({ mainHeadingStart: "Hello" });
    expect(m.sections.heroTicks).toEqual(["One", "Two"]);
    expect(m.content.faqs).toEqual([{ q: "Q1", a: "A1" }]);
    expect(m.sections.featureGroups).toEqual([{ title: "Network", body: "b", icon: "router", bullets: ["x"] }]);
    expect(m.sections.customerPoints?.[0]?.icon).toBe("users");
    expect(m.content.pricing).toEqual({ starterMonthly: 4000 });
    expect(m.sections.steps).toBeUndefined();
    expect(m.content.footer).toBeUndefined();
  });

  it("returns null for no document", () => {
    expect(mapHomepage(null)).toBeNull();
  });
});

describe("Sanity webhook signature", () => {
  const secret = "s3cret";
  const body = JSON.stringify({ _id: "homepage" });
  const sign = (t: number, b = body, key = secret) => `t=${t},v1=${createHmac("sha256", key).update(`${t}.${b}`).digest("base64url")}`;
  const now = 1_780_000_000_000;

  it("accepts a fresh, correctly signed delivery", () => {
    expect(verifySanitySignature(sign(now), body, secret, now)).toBe(true);
  });
  it("refuses a wrong secret, a changed body, a stale time and no header", () => {
    expect(verifySanitySignature(sign(now, body, "other"), body, secret, now)).toBe(false);
    expect(verifySanitySignature(sign(now), body + " ", secret, now)).toBe(false);
    expect(verifySanitySignature(sign(now - 10 * 60 * 1000), body, secret, now)).toBe(false);
    expect(verifySanitySignature(null, body, secret, now)).toBe(false);
  });
});

describe("the Studio seed", () => {
  it("maps back to exactly the homepage the site shows today", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { DEFAULT_LANDING_SECTIONS } = await import("./landing-sections");
    const { DEFAULT_LANDING_CONTENT } = await import("./landing-content");
    const seed = JSON.parse(readFileSync(resolve(__dirname, "../../../../studio/seed/homepage.ndjson"), "utf8"));
    const m = mapHomepage(seed)!;
    expect(m.sections).toEqual(DEFAULT_LANDING_SECTIONS);
    expect(m.content.faqs).toEqual(DEFAULT_LANDING_CONTENT.faqs);
    expect(m.content.hero).toEqual(DEFAULT_LANDING_CONTENT.hero);
    expect(m.content.footer).toEqual(DEFAULT_LANDING_CONTENT.footer);
  });
});

describe("fetching from Sanity", () => {
  it("queries the published homepage on the CDN and maps it", async () => {
    const { vi } = await import("vitest");
    const { fetchSanityHomepage } = await import("./sanity");
    process.env.SANITY_PROJECT_ID = "abc123";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { hero: { mainHeadingStart: "From Sanity" } } })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchSanityHomepage();
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toMatch(/^https:\/\/abc123\.apicdn\.sanity\.io\/v2025-01-01\/data\/query\/production\?query=/);
    expect(url).toContain("perspective=published");
    expect(r?.content.hero).toEqual({ mainHeadingStart: "From Sanity" });
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    expect(await fetchSanityHomepage()).toBeNull();
    vi.unstubAllGlobals();
    delete process.env.SANITY_PROJECT_ID;
  });
});
