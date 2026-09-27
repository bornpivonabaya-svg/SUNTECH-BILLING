import { describe, expect, it } from "vitest";
import { buildAloginPage } from "../../lib/router-pages.js";

describe("the router's 'you're online' page", () => {
  const html = buildAloginPage(`Mash <Wi-Fi> & $(username) "Co"`);

  it("tells the customer they're online, in English and Kiswahili, with the time left", () => {
    expect(html).toContain("You're online");
    expect(html).toContain("Umeunganishwa na intaneti");
    expect(html).toContain("$(if session-time-left)");
    expect(html).toContain("$(session-time-left)");
  });

  it("moves the window on to the page they asked for, so the phone closes its sign-in window", () => {
    expect(html).toContain('<meta http-equiv="refresh" content="3; url=$(link-redirect)">');
    expect(html).toContain('href="$(link-redirect)"');
  });

  it("escapes the ISP's name and can't be used to inject a router variable", () => {
    expect(html).toContain('<p class="brand">Mash &lt;Wi-Fi&gt; &amp; $ (username) &quot;Co&quot;</p>');
    expect(html).not.toContain("$(username)");
  });
});
