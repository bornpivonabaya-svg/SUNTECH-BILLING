import { describe, expect, it } from "vitest";
import { checkDomainPointsTo, findZone, planDomainSetup, providerFromNameservers } from "../domain-provider.js";

const nsTable: Record<string, string[]> = {
  "isp.co.ke": ["dns1.registrar-servers.com", "dns2.registrar-servers.com"],
  "co.ke": ["ns1.kenic.or.ke"],
  "fibre.com": ["ns51.domaincontrol.com"],
  "wave.africa": ["ns1.dns-parking.com"],
  "cf.net": ["kara.ns.cloudflare.com."],
  "odd.org": ["ns1.example-dns.org"],
};
const ns = async (name: string) => {
  const r = nsTable[name];
  if (!r) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
  return r;
};
const target = "demo-isp.billing.example.com";

describe("detecting the domain company", () => {
  it("names the big ones from their nameservers", () => {
    expect(providerFromNameservers(["dns1.registrar-servers.com"])?.name).toBe("Namecheap");
    expect(providerFromNameservers(["ns51.domaincontrol.com."])?.name).toBe("GoDaddy");
    expect(providerFromNameservers(["ns1.dns-parking.com"])?.name).toBe("Hostinger");
    expect(providerFromNameservers(["kara.ns.cloudflare.com"])?.name).toBe("Cloudflare");
    expect(providerFromNameservers(["ns-12.awsdns-01.org"])?.name).toBe("Amazon Route 53");
    expect(providerFromNameservers(["ns1.example-dns.org"])).toBeNull();
  });

  it("finds the zone from a subdomain, not the registry above it", async () => {
    expect(await findZone("wifi.isp.co.ke", ns)).toEqual({ zone: "isp.co.ke", nameservers: nsTable["isp.co.ke"] });
  });

  it("plans a CNAME with the host part in the provider's own words and a deep link", async () => {
    const p = await planDomainSetup("wifi.isp.co.ke", target, { ns });
    expect(p.provider.name).toBe("Namecheap");
    expect(p.detected).toBe(true);
    expect(p.records).toEqual([{ type: "CNAME", host: "wifi", value: target, ttl: expect.any(String) }]);
    expect(p.dnsUrl).toBe("https://ap.www.namecheap.com/domains/domaincontrolpanel/isp.co.ke/advancedns");
  });

  it("gives A records for a root domain, except on Cloudflare which flattens CNAMEs", async () => {
    const a = async () => ["203.0.113.7"];
    const root = await planDomainSetup("fibre.com", target, { ns, a });
    expect(root.isRoot).toBe(true);
    expect(root.records).toEqual([{ type: "A", host: "@", value: "203.0.113.7", ttl: expect.any(String) }]);
    const cf = await planDomainSetup("cf.net", target, { ns, a });
    expect(cf.records[0]).toMatchObject({ type: "CNAME", host: "@" });
    expect(cf.provider.note).toMatch(/grey/);
  });

  it("falls back to general steps when the company isn't known", async () => {
    const p = await planDomainSetup("pay.odd.org", target, { ns });
    expect(p.detected).toBe(false);
    expect(p.provider.steps.length).toBeGreaterThan(0);
    expect(p.records[0]!.host).toBe("pay");
  });
});

describe("checking a domain points here", () => {
  const none = async () => {
    throw new Error("ENODATA");
  };
  it("accepts the right CNAME", async () => {
    expect(await checkDomainPointsTo("wifi.isp.co.ke", target, { cname: async () => [`${target}.`], a: none })).toEqual({ ok: true, via: "CNAME" });
  });
  it("accepts a root domain whose A records match ours", async () => {
    const a = async () => ["203.0.113.7"];
    expect(await checkDomainPointsTo("fibre.com", target, { cname: none, a })).toEqual({ ok: true, via: "A" });
  });
  it("explains a wrong CNAME and a missing record", async () => {
    const wrong = await checkDomainPointsTo("wifi.isp.co.ke", target, { cname: async () => ["parking.host.com"], a: none });
    expect(wrong).toMatchObject({ ok: false, reason: expect.stringContaining("parking.host.com") });
    const missing = await checkDomainPointsTo("wifi.isp.co.ke", target, { cname: none, a: none });
    expect(missing).toMatchObject({ ok: false, reason: expect.stringContaining("No record") });
  });
});
