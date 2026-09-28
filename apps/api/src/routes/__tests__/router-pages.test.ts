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

  it("moves the window on to a real page, never back to the phone's connectivity check", () => {
    // generate_204 answers with nothing, so going back to it left Android's sign-in window open.
    expect(html).not.toContain("url=$(link-redirect)");
    expect(html).toContain('decodeURIComponent("$(link-redirect-esc)")');
    expect(html).toContain('href="http://www.google.com/"');
    expect(html).toContain("mkg-alogin-2");
  });

  it("sends a connectivity check to Google and any other page back to itself", () => {
    const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
    const destination = (redirect: string) => {
      const go = { href: "" };
      let replaced = "";
      const run = new Function("document", "window", "setTimeout", script.replace("$(link-redirect-esc)", encodeURIComponent(redirect)));
      run({ getElementById: () => go }, { location: { replace: (u: string) => (replaced = u) } }, (f: () => void) => f());
      expect(replaced).toBe(go.href);
      return go.href;
    };
    expect(destination("http://connectivitycheck.gstatic.com/generate_204")).toBe("http://www.google.com/");
    expect(destination("http://captive.apple.com/hotspot-detect.html")).toBe("http://www.google.com/");
    expect(destination("http://www.msftconnecttest.com/connecttest.txt")).toBe("http://www.google.com/");
    expect(destination("")).toBe("http://www.google.com/");
    expect(destination("http://news.example.com/today")).toBe("http://news.example.com/today");
  });

  it("escapes the ISP's name and can't be used to inject a router variable", () => {
    expect(html).toContain('<p class="brand">Mash &lt;Wi-Fi&gt; &amp; $ (username) &quot;Co&quot;</p>');
    expect(html).not.toContain("$(username)");
  });
});
