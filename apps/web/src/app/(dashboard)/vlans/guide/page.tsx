"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { useLanguage } from "@/lib/language-context";
import { CodeBlock, Notice, PageHeader, Panel, Segmented, darkButton } from "@/components/dashboard/surface";
import { Input, Label } from "@/components/ui";

/**
 * The VLAN manual: how to patch a managed switch to the router so one VLAN runs the hotspot and
 * another runs PPPoE, each on its own, and how a PPPoE customer actually gets online. The router
 * and switch commands are generated from the ISP's own VLANs and port names.
 */

type Service = "hotspot" | "pppoe";

interface VlanRow {
  id: string;
  vlanTag: number;
  name: string;
  type: string;
  subnetCidr: string | null;
  gateway: string | null;
  router: { id: string; name: string } | null;
}

const S = {
  en: {
    title: "VLAN manual",
    lead: "Patch a switch to your MikroTik so one VLAN runs the hotspot and another runs PPPoE, each on its own. The commands below are made from your own VLANs and ports.",
    back: "Back to VLANs",
    pictureTitle: "What you're building",
    pictureLead: "One cable (the trunk) carries every VLAN from the router to the switch. Each switch port then belongs to one VLAN, so whatever is plugged into it lands on that service.",
    internet: "Internet",
    router: "MikroTik router",
    wan: "ether1 WAN",
    trunk: "trunk (tagged)",
    sw: "Managed switch",
    ap: "Access points",
    apSub: "hotspot, untagged",
    cpe: "Customer routers / ONUs",
    cpeSub: "PPPoE, untagged",
    beforeTitle: "Before you start",
    before: [
      "The router is added and its main setup script has run (Routers > Add router). RADIUS, the login page, the walled garden and internet sharing come from that script; every VLAN reuses them.",
      "You have a managed switch (one that supports 802.1Q VLANs). An unmanaged switch drops or mixes tagged traffic.",
      "Pick a tag and a subnet for each service and write them down. For example: VLAN 20 for hotspot on 10.20.0.0/22, VLAN 30 for PPPoE on 10.30.0.0/20. Avoid VLAN 1: most switches use it for untagged traffic.",
      "Pick a router port for the trunk that is NOT one of the router's hotspot ports (for example ether5 or sfp1). The script takes it out of the LAN bridge.",
    ],
    patchTitle: "1. Patch the cables",
    patch: [
      "Router trunk port (e.g. ether5) → switch port 1. This cable carries all VLANs, tagged.",
      "Switch ports for the hotspot (e.g. 2–8) → access points. Each is an access port on the hotspot VLAN, untagged.",
      "Switch ports for PPPoE (e.g. 9–16) → customer routers, ONUs or the next building's switch. Each is an access port on the PPPoE VLAN, untagged.",
      "Keep the WAN (ether1) cable where it is: it is the internet, not part of any VLAN.",
      "Label both ends of the trunk. Unplugging it takes every VLAN down at once.",
    ],
    switchTitle: "2. Set up the switch",
    switchLead: "On any managed switch (TP-Link, Netgear, Cisco, Ubiquiti…): make the trunk port a member of every VLAN, tagged; make each access port a member of one VLAN, untagged, and set its PVID (port VLAN ID) to that VLAN. If the switch is a MikroTik (CRS, CSS on SwOS, or a hAP used as a switch), paste the commands below.",
    uplink: "Switch port to the router",
    hsTag: "Hotspot VLAN",
    hsPorts: "Hotspot access ports",
    pppTag: "PPPoE VLAN",
    pppPorts: "PPPoE access ports",
    portsHint: "Comma-separated, e.g. ether2,ether3,ether4",
    switchNote: "vlan-filtering is switched on last: turning it on before the VLAN table is filled cuts you off. On a CRS3xx this runs in hardware; on a hAP used as a switch it runs on the CPU, which is fine for a few hundred customers.",
    routerTitle: "3. Set up the router, one VLAN at a time",
    routerLead: "Pick one of your VLANs (or type the values), choose what runs on it, and paste the script into the router's terminal. Run it once per VLAN: once for the hotspot VLAN, once for the PPPoE VLAN.",
    fromVlan: "Fill from a VLAN",
    typeIt: "Type the values",
    service: "Runs on this VLAN",
    hotspot: "Hotspot",
    pppoe: "PPPoE",
    tag: "VLAN tag",
    name: "Name",
    trunkPort: "Router trunk port",
    subnet: "Subnet",
    gateway: "Gateway (optional)",
    gatewayHint: "Leave empty to use the subnet's first address.",
    dns: "DNS servers (optional)",
    generate: "Make the script",
    making: "Making…",
    scriptLabel: (t: number, s: Service) => `RouterOS terminal: VLAN ${t} ${s === "hotspot" ? "hotspot" : "PPPoE"}`,
    noVlans: "No VLANs yet. Create them on the VLANs page, or type the values.",
    hsTitle: "How the hotspot VLAN comes up on its own",
    hs: [
      "The script makes a VLAN interface on the trunk port, gives it the gateway address, a DHCP server and an address pool, and starts a hotspot server on that interface only.",
      "A phone joins an access point on the hotspot VLAN. The switch passes its traffic to the router tagged with the hotspot VLAN, so it arrives on that VLAN's interface.",
      "The VLAN's DHCP server gives the phone an address, and the hotspot server on that interface catches its first web request and shows your login page.",
      "The phone pays (M-Pesa) or enters a voucher; the router asks the platform over RADIUS, which answers with the package's speed and time. The phone is online.",
      "Because the server belongs to this VLAN alone, you can stop, restart or change it without touching the main hotspot or the PPPoE VLAN, and a fault on one doesn't take the other down.",
    ],
    pppTitle: "How PPPoE connects and works",
    ppp: [
      "Add the customer in the dashboard with a PPPoE package. The platform creates their PPPoE username and password in RADIUS, with their speed.",
      "On the customer's router (or ONU), set the WAN (internet) connection type to PPPoE and enter that username and password. Leave its VLAN ID empty when the switch port is untagged; set it to the PPPoE VLAN only if the port is tagged.",
      "The customer's router broadcasts a PPPoE discovery (PADI). It reaches only the PPPoE VLAN, where your MikroTik's PPPoE server answers (PADO), and the two agree on a session (PADR, PADS).",
      "The customer's router sends the username and password (PAP or CHAP). The MikroTik passes them to the platform over RADIUS.",
      "If the account is active and paid, RADIUS accepts and returns the speed (Mikrotik-Rate-Limit) and, if you set one, a fixed IP. Otherwise it rejects and the router shows an authentication failure.",
      "The session comes up: the customer gets an address from the VLAN's pool, the router's side is the gateway, and traffic is shared to the internet through ether1.",
      "Every minute the router reports usage to the platform (accounting). That is what the Online users page and usage limits read.",
      "When the plan runs out or is suspended, the platform disconnects the session and RADIUS refuses the next login. After the customer pays, the next dial-in succeeds. Most customer routers redial within a minute.",
    ],
    checkTitle: "4. Check it works",
    checkLead: "Run these in the router's terminal:",
    troubleTitle: "If something doesn't work",
    trouble: [
      "Nothing gets an address on the hotspot VLAN: the trunk port is still in the LAN bridge, or the switch access port's PVID isn't the hotspot VLAN. Re-run the script, then check the switch.",
      "The login page doesn't show: the router's main setup script hasn't been run, or the page's host isn't in the walled garden (Routers > Walled garden).",
      "PPPoE says \"authentication failed\": the username or password is wrong, or the customer's plan isn't active. Check the customer's page.",
      "PPPoE doesn't find a server at all: the customer's port is on the wrong VLAN, or the customer's router has a VLAN ID set while the switch port is untagged.",
      "Some websites don't load over PPPoE: an MTU problem. The script sets MTU 1480 and clamps TCP MSS; make sure the customer's router isn't forcing 1500.",
      "Everything stopped at once: the trunk cable, or the switch port it's in. Check the link lights and /interface print.",
    ],
  },
  sw: {
    title: "Mwongozo wa VLAN",
    lead: "Unganisha swichi na MikroTik yako ili VLAN moja iendeshe hotspot na nyingine iendeshe PPPoE, kila moja peke yake. Amri zilizo hapa chini zinatengenezwa kutoka kwa VLAN na milango yako mwenyewe.",
    back: "Rudi kwa VLAN",
    pictureTitle: "Unachojenga",
    pictureLead: "Kebo moja (trunk) inabeba kila VLAN kutoka ruta hadi swichi. Kisha kila mlango wa swichi ni wa VLAN moja, kwa hivyo chochote kinachochomekwa humo kinaingia kwenye huduma hiyo.",
    internet: "Intaneti",
    router: "Ruta ya MikroTik",
    wan: "ether1 WAN",
    trunk: "trunk (yenye tagi)",
    sw: "Swichi inayosimamiwa",
    ap: "Vituo vya Wi-Fi",
    apSub: "hotspot, bila tagi",
    cpe: "Ruta za wateja / ONU",
    cpeSub: "PPPoE, bila tagi",
    beforeTitle: "Kabla ya kuanza",
    before: [
      "Ruta imeongezwa na skripti yake kuu ya usanidi imeendeshwa (Ruta > Ongeza ruta). RADIUS, ukurasa wa kuingia, tovuti zinazoruhusiwa na kushiriki intaneti vinatoka kwenye skripti hiyo; kila VLAN inavitumia.",
      "Una swichi inayosimamiwa (inayokubali VLAN za 802.1Q). Swichi isiyosimamiwa inaangusha au kuchanganya trafiki yenye tagi.",
      "Chagua tagi na subnet kwa kila huduma na uziandike. Kwa mfano: VLAN 20 kwa hotspot kwenye 10.20.0.0/22, VLAN 30 kwa PPPoE kwenye 10.30.0.0/20. Epuka VLAN 1: swichi nyingi huitumia kwa trafiki isiyo na tagi.",
      "Chagua mlango wa ruta kwa trunk ambao SI mmoja wa milango ya hotspot ya ruta (kwa mfano ether5 au sfp1). Skripti inauondoa kwenye bridge ya LAN.",
    ],
    patchTitle: "1. Unganisha kebo",
    patch: [
      "Mlango wa trunk wa ruta (k.m. ether5) → mlango 1 wa swichi. Kebo hii inabeba VLAN zote, zikiwa na tagi.",
      "Milango ya swichi ya hotspot (k.m. 2–8) → vituo vya Wi-Fi. Kila mmoja ni mlango wa kufikia kwenye VLAN ya hotspot, bila tagi.",
      "Milango ya swichi ya PPPoE (k.m. 9–16) → ruta za wateja, ONU au swichi ya jengo linalofuata. Kila mmoja ni mlango wa kufikia kwenye VLAN ya PPPoE, bila tagi.",
      "Acha kebo ya WAN (ether1) ilipo: ndiyo intaneti, si sehemu ya VLAN yoyote.",
      "Weka alama pande zote mbili za trunk. Ukiichomoa, VLAN zote zinazima kwa pamoja.",
    ],
    switchTitle: "2. Sanidi swichi",
    switchLead: "Kwenye swichi yoyote inayosimamiwa (TP-Link, Netgear, Cisco, Ubiquiti…): fanya mlango wa trunk kuwa mwanachama wa kila VLAN, ukiwa na tagi; fanya kila mlango wa kufikia kuwa mwanachama wa VLAN moja, bila tagi, na uweke PVID yake kuwa VLAN hiyo. Ikiwa swichi ni MikroTik (CRS, CSS kwenye SwOS, au hAP inayotumika kama swichi), bandika amri zilizo hapa chini.",
    uplink: "Mlango wa swichi kwenda ruta",
    hsTag: "VLAN ya hotspot",
    hsPorts: "Milango ya kufikia ya hotspot",
    pppTag: "VLAN ya PPPoE",
    pppPorts: "Milango ya kufikia ya PPPoE",
    portsHint: "Tenganisha kwa koma, k.m. ether2,ether3,ether4",
    switchNote: "vlan-filtering inawashwa mwisho: kuiwasha kabla jedwali la VLAN halijajazwa kunakukata. Kwenye CRS3xx inaendeshwa na vifaa; kwenye hAP inayotumika kama swichi inaendeshwa na CPU, jambo ambalo linatosha kwa wateja mia chache.",
    routerTitle: "3. Sanidi ruta, VLAN moja kwa wakati",
    routerLead: "Chagua moja ya VLAN zako (au andika thamani), chagua kinachoendeshwa juu yake, na ubandike skripti kwenye terminal ya ruta. Iendeshe mara moja kwa kila VLAN: mara moja kwa VLAN ya hotspot, mara moja kwa VLAN ya PPPoE.",
    fromVlan: "Jaza kutoka VLAN",
    typeIt: "Andika thamani",
    service: "Kinachoendeshwa kwenye VLAN hii",
    hotspot: "Hotspot",
    pppoe: "PPPoE",
    tag: "Tagi ya VLAN",
    name: "Jina",
    trunkPort: "Mlango wa trunk wa ruta",
    subnet: "Subnet",
    gateway: "Gateway (si lazima)",
    gatewayHint: "Acha tupu kutumia anwani ya kwanza ya subnet.",
    dns: "Seva za DNS (si lazima)",
    generate: "Tengeneza skripti",
    making: "Inatengeneza…",
    scriptLabel: (t: number, s: Service) => `Terminal ya RouterOS: VLAN ${t} ${s === "hotspot" ? "hotspot" : "PPPoE"}`,
    noVlans: "Bado hakuna VLAN. Ziunde kwenye ukurasa wa VLAN, au andika thamani.",
    hsTitle: "Jinsi VLAN ya hotspot inavyowaka yenyewe",
    hs: [
      "Skripti inaunda kiolesura cha VLAN kwenye mlango wa trunk, inakipa anwani ya gateway, seva ya DHCP na kundi la anwani, na inawasha seva ya hotspot kwenye kiolesura hicho pekee.",
      "Simu inajiunga na kituo cha Wi-Fi kwenye VLAN ya hotspot. Swichi inapitisha trafiki yake kwa ruta ikiwa na tagi ya VLAN ya hotspot, kwa hivyo inafika kwenye kiolesura cha VLAN hiyo.",
      "Seva ya DHCP ya VLAN inaipa simu anwani, na seva ya hotspot kwenye kiolesura hicho inanasa ombi lake la kwanza la wavuti na kuonyesha ukurasa wako wa kuingia.",
      "Simu inalipa (M-Pesa) au inaweka vocha; ruta inauliza jukwaa kupitia RADIUS, ambalo linajibu kwa kasi na muda wa kifurushi. Simu iko mtandaoni.",
      "Kwa sababu seva ni ya VLAN hii pekee, unaweza kuisimamisha, kuiwasha upya au kuibadilisha bila kugusa hotspot kuu au VLAN ya PPPoE, na hitilafu kwenye moja haiangushi nyingine.",
    ],
    pppTitle: "Jinsi PPPoE inavyounganisha na kufanya kazi",
    ppp: [
      "Ongeza mteja kwenye dashibodi na kifurushi cha PPPoE. Jukwaa linaunda jina la mtumiaji na nenosiri la PPPoE kwenye RADIUS, pamoja na kasi yake.",
      "Kwenye ruta ya mteja (au ONU), weka aina ya muunganisho wa WAN (intaneti) kuwa PPPoE na uweke jina hilo la mtumiaji na nenosiri. Acha VLAN ID yake tupu ikiwa mlango wa swichi hauna tagi; iweke kuwa VLAN ya PPPoE tu ikiwa mlango una tagi.",
      "Ruta ya mteja inatangaza ugunduzi wa PPPoE (PADI). Unafika kwenye VLAN ya PPPoE pekee, ambapo seva ya PPPoE ya MikroTik yako inajibu (PADO), na zote mbili zinakubaliana kikao (PADR, PADS).",
      "Ruta ya mteja inatuma jina la mtumiaji na nenosiri (PAP au CHAP). MikroTik inazipeleka kwa jukwaa kupitia RADIUS.",
      "Ikiwa akaunti iko hai na imelipwa, RADIUS inakubali na kurudisha kasi (Mikrotik-Rate-Limit) na, ukiweka, IP ya kudumu. La sivyo inakataa na ruta inaonyesha kushindwa kwa uthibitishaji.",
      "Kikao kinawaka: mteja anapata anwani kutoka kwa kundi la VLAN, upande wa ruta ni gateway, na trafiki inashirikiwa kwa intaneti kupitia ether1.",
      "Kila dakika ruta inaripoti matumizi kwa jukwaa (accounting). Hicho ndicho ukurasa wa Watumiaji mtandaoni na vikomo vya matumizi vinasoma.",
      "Mpango ukiisha au ukisimamishwa, jukwaa linakata kikao na RADIUS inakataa kuingia kunakofuata. Baada ya mteja kulipa, kupiga simu kunakofuata kunafaulu. Ruta nyingi za wateja hupiga tena ndani ya dakika moja.",
    ],
    checkTitle: "4. Hakikisha inafanya kazi",
    checkLead: "Endesha hizi kwenye terminal ya ruta:",
    troubleTitle: "Kitu kisipofanya kazi",
    trouble: [
      "Hakuna kinachopata anwani kwenye VLAN ya hotspot: mlango wa trunk bado uko kwenye bridge ya LAN, au PVID ya mlango wa kufikia wa swichi si VLAN ya hotspot. Endesha skripti tena, kisha angalia swichi.",
      "Ukurasa wa kuingia hauonekani: skripti kuu ya usanidi ya ruta haijaendeshwa, au mwenyeji wa ukurasa hayuko kwenye tovuti zinazoruhusiwa (Ruta > Tovuti zinazoruhusiwa).",
      "PPPoE inasema \"authentication failed\": jina la mtumiaji au nenosiri si sahihi, au mpango wa mteja hauko hai. Angalia ukurasa wa mteja.",
      "PPPoE haipati seva kabisa: mlango wa mteja uko kwenye VLAN isiyo sahihi, au ruta ya mteja ina VLAN ID wakati mlango wa swichi hauna tagi.",
      "Tovuti zingine hazifunguki kupitia PPPoE: tatizo la MTU. Skripti inaweka MTU 1480 na kubana TCP MSS; hakikisha ruta ya mteja hailazimishi 1500.",
      "Kila kitu kilisimama kwa pamoja: kebo ya trunk, au mlango wa swichi ilimo. Angalia taa za kiungo na /interface print.",
    ],
  },
};

type Strings = (typeof S)["en"];

const splitPorts = (v: string) =>
  v
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => /^[a-zA-Z0-9_.-]+$/.test(p));

/** MikroTik switch config (bridge VLAN filtering), RouterOS 6.41+ and 7. */
function switchScript(uplink: string, hsTag: number, hsPorts: string[], pppTag: number, pppPorts: string[]): string {
  const lines = [
    "# MikroTik used as the VLAN switch. Run from a port that is NOT listed below, or over WinBox by MAC.",
    "/interface bridge add name=sw-bridge vlan-filtering=no",
    `/interface bridge port add bridge=sw-bridge interface=${uplink} comment="trunk to router"`,
    ...hsPorts.map((p) => `/interface bridge port add bridge=sw-bridge interface=${p} pvid=${hsTag} comment="hotspot"`),
    ...pppPorts.map((p) => `/interface bridge port add bridge=sw-bridge interface=${p} pvid=${pppTag} comment="pppoe"`),
    `/interface bridge vlan add bridge=sw-bridge vlan-ids=${hsTag} tagged=${uplink}${hsPorts.length ? ` untagged=${hsPorts.join(",")}` : ""}`,
    `/interface bridge vlan add bridge=sw-bridge vlan-ids=${pppTag} tagged=${uplink}${pppPorts.length ? ` untagged=${pppPorts.join(",")}` : ""}`,
    "# Last: switch filtering on only once the table above is complete.",
    "/interface bridge set sw-bridge vlan-filtering=yes",
  ];
  return lines.join("\n");
}

function Diagram({ t, hsTag, pppTag }: { t: Strings; hsTag: number; pppTag: number }) {
  const box = "fill-obsidian-900 stroke-obsidian-600";
  return (
    <svg viewBox="0 0 720 250" role="img" aria-label={t.pictureTitle} className="h-auto w-full max-w-3xl text-slate-200">
      <rect x="10" y="95" width="110" height="50" rx="8" className={box} strokeWidth="1.5" />
      <text x="65" y="125" textAnchor="middle" className="fill-slate-200 text-[13px]">{t.internet}</text>
      <line x1="120" y1="120" x2="200" y2="120" className="stroke-slate-500" strokeWidth="2" />
      <text x="160" y="112" textAnchor="middle" className="fill-slate-400 text-[10px]">{t.wan}</text>

      <rect x="200" y="85" width="140" height="70" rx="8" className="fill-obsidian-800 stroke-blue-500" strokeWidth="1.5" />
      <text x="270" y="118" textAnchor="middle" className="fill-white text-[13px] font-semibold">{t.router}</text>
      <text x="270" y="136" textAnchor="middle" className="fill-slate-400 text-[10px]">RADIUS · hotspot · PPPoE</text>

      <line x1="340" y1="120" x2="420" y2="120" className="stroke-amber-400" strokeWidth="4" />
      <text x="380" y="110" textAnchor="middle" className="fill-amber-300 text-[10px]">{t.trunk}</text>
      <text x="380" y="140" textAnchor="middle" className="fill-amber-300 text-[10px]">{`VLAN ${hsTag} + ${pppTag}`}</text>

      <rect x="420" y="85" width="120" height="70" rx="8" className={box} strokeWidth="1.5" />
      <text x="480" y="124" textAnchor="middle" className="fill-slate-200 text-[13px]">{t.sw}</text>

      <line x1="540" y1="105" x2="580" y2="55" className="stroke-emerald-400" strokeWidth="2" />
      <rect x="580" y="25" width="130" height="56" rx="8" className="fill-obsidian-900 stroke-emerald-500" strokeWidth="1.5" />
      <text x="645" y="48" textAnchor="middle" className="fill-slate-100 text-[12px]">{t.ap}</text>
      <text x="645" y="66" textAnchor="middle" className="fill-emerald-300 text-[10px]">{`VLAN ${hsTag} · ${t.apSub}`}</text>

      <line x1="540" y1="135" x2="580" y2="185" className="stroke-sky-400" strokeWidth="2" />
      <rect x="580" y="160" width="130" height="56" rx="8" className="fill-obsidian-900 stroke-sky-500" strokeWidth="1.5" />
      <text x="645" y="183" textAnchor="middle" className="fill-slate-100 text-[12px]">{t.cpe}</text>
      <text x="645" y="201" textAnchor="middle" className="fill-sky-300 text-[10px]">{`VLAN ${pppTag} · ${t.cpeSub}`}</text>
    </svg>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300 marker:text-slate-500">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

export default function VlanGuidePage() {
  const { lang } = useLanguage();
  const t = S[lang];
  const { data: vlans } = useQuery({ queryKey: ["vlans", "guide"], queryFn: () => apiFetch<VlanRow[]>("/api/v1/vlans") });

  const [mode, setMode] = useState<"record" | "manual">("record");
  const [vlanId, setVlanId] = useState("");
  const [service, setService] = useState<Service>("hotspot");
  const [tag, setTag] = useState("20");
  const [name, setName] = useState("");
  const [trunk, setTrunk] = useState("ether5");
  const [subnet, setSubnet] = useState("10.20.0.0/22");
  const [gateway, setGateway] = useState("");
  const [dns, setDns] = useState("");
  const [script, setScript] = useState<{ script: string; tag: number; service: Service } | null>(null);

  const [uplink, setUplink] = useState("ether1");
  const [hsTag, setHsTag] = useState("20");
  const [hsPorts, setHsPorts] = useState("ether2,ether3,ether4");
  const [pppTag, setPppTag] = useState("30");
  const [pppPorts, setPppPorts] = useState("ether5,ether6,ether7,ether8");

  const hsNum = Number(hsTag) || 20;
  const pppNum = Number(pppTag) || 30;
  const sw = useMemo(
    () => switchScript(splitPorts(uplink)[0] ?? "ether1", hsNum, splitPorts(hsPorts), pppNum, splitPorts(pppPorts)),
    [uplink, hsNum, hsPorts, pppNum, pppPorts]
  );

  function pickVlan(id: string) {
    setVlanId(id);
    const v = vlans?.find((x) => x.id === id);
    if (!v) return;
    setTag(String(v.vlanTag));
    setName(v.name);
    setSubnet(v.subnetCidr ?? "");
    setGateway(v.gateway ?? "");
    const svc: Service = v.type === "HOTSPOT" || v.type === "GUEST" ? "hotspot" : "pppoe";
    setService(svc);
    if (svc === "hotspot") setHsTag(String(v.vlanTag));
    else setPppTag(String(v.vlanTag));
  }

  const make = useMutation({
    mutationFn: () =>
      apiFetch<{ script: string }>("/api/v1/vlans/setup-script", {
        method: "POST",
        body: JSON.stringify({
          service,
          vlanTag: Number(tag),
          name,
          trunkInterface: trunk.trim(),
          subnetCidr: subnet.trim(),
          gateway: gateway.trim() || null,
          dnsServers: dns.split(/[\s,]+/).filter(Boolean),
        }),
      }),
    onSuccess: (r) => setScript({ script: r.script, tag: Number(tag), service }),
  });

  const field = (id: string, label: string, value: string, set: (v: string) => void, hint?: string, placeholder?: string) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );

  return (
    <div className="w-full min-w-0 space-y-6">
      <PageHeader
        title={t.title}
        description={t.lead}
        actions={
          <Link href="/vlans" className={darkButton("ghost", "sm")}>
            {t.back}
          </Link>
        }
      />

      <Panel title={t.pictureTitle} description={t.pictureLead}>
        <Diagram t={t} hsTag={hsNum} pppTag={pppNum} />
      </Panel>

      <Panel title={t.beforeTitle}>
        <Steps items={t.before} />
      </Panel>

      <Panel title={t.patchTitle}>
        <Steps items={t.patch} />
      </Panel>

      <Panel title={t.switchTitle} description={t.switchLead}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {field("sw-uplink", t.uplink, uplink, setUplink)}
            {field("sw-hstag", t.hsTag, hsTag, setHsTag)}
            {field("sw-hsports", t.hsPorts, hsPorts, setHsPorts, t.portsHint)}
            {field("sw-ppptag", t.pppTag, pppTag, setPppTag)}
            {field("sw-pppports", t.pppPorts, pppPorts, setPppPorts)}
          </div>
          <CodeBlock code={sw} label="MikroTik switch" maxHeight="16rem" />
          <p className="text-xs text-slate-500">{t.switchNote}</p>
        </div>
      </Panel>

      <Panel title={t.routerTitle} description={t.routerLead}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            make.mutate();
          }}
        >
          <div className="flex flex-wrap items-end gap-4">
            <Segmented
              label={`${t.fromVlan} / ${t.typeIt}`}
              value={mode}
              onChange={setMode}
              options={[
                { value: "record", label: t.fromVlan },
                { value: "manual", label: t.typeIt },
              ]}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{t.service}</span>
              <Segmented
                label={t.service}
                value={service}
                onChange={setService}
                options={[
                  { value: "hotspot", label: t.hotspot },
                  { value: "pppoe", label: t.pppoe },
                ]}
              />
            </div>
          </div>
          {mode === "record" &&
            (vlans && vlans.length > 0 ? (
              <div>
                <Label htmlFor="g-vlan">{t.fromVlan}</Label>
                <select
                  id="g-vlan"
                  value={vlanId}
                  onChange={(e) => pickVlan(e.target.value)}
                  className="w-full max-w-md rounded-lg border border-obsidian-700 bg-obsidian-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">—</option>
                  {vlans.map((v) => (
                    <option key={v.id} value={v.id}>
                      {`VLAN ${v.vlanTag} · ${v.name}${v.subnetCidr ? ` · ${v.subnetCidr}` : ""}${v.router ? ` · ${v.router.name}` : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Notice tone="neutral">{t.noVlans}</Notice>
            ))}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {field("g-tag", t.tag, tag, setTag)}
            {field("g-name", t.name, name, setName)}
            {field("g-trunk", t.trunkPort, trunk, setTrunk, undefined, "ether5")}
            {field("g-subnet", t.subnet, subnet, setSubnet, undefined, "10.20.0.0/22")}
            {field("g-gw", t.gateway, gateway, setGateway, t.gatewayHint)}
            {field("g-dns", t.dns, dns, setDns, undefined, "1.1.1.1, 8.8.8.8")}
          </div>
          <button type="submit" className={darkButton("primary", "sm")} disabled={make.isPending || !tag || !subnet || !trunk}>
            {make.isPending ? t.making : t.generate}
          </button>
          {make.isError && <Notice tone="bad">{make.error instanceof ApiRequestError ? make.error.message : String(make.error)}</Notice>}
          {script && <CodeBlock code={script.script} label={t.scriptLabel(script.tag, script.service)} maxHeight="24rem" />}
        </form>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t.hsTitle}>
          <Steps items={t.hs} />
        </Panel>
        <Panel title={t.pppTitle}>
          <Steps items={t.ppp} />
        </Panel>
      </div>

      <Panel title={t.checkTitle} description={t.checkLead}>
        <CodeBlock
          code={[
            "/interface vlan print",
            "/ip hotspot print",
            "/ip hotspot active print",
            "/interface pppoe-server server print",
            "/ppp active print",
            '/log print where topics~"hotspot|pppoe|radius"',
          ].join("\n")}
          maxHeight="12rem"
        />
      </Panel>

      <Panel title={t.troubleTitle}>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300 marker:text-slate-500">
          {t.trouble.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
