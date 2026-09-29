import { LegalShell } from "@/components/marketing/legal-shell";

export default function TermsOfServicePage() {
  return (
    <LegalShell
      active="/terms"
      category="Standard Telecom Agreement"
      effective="August 28, 2026"
      title="Terms of Service"
      intro={
        <>
          Please read these Terms of Service carefully before utilizing the Suntech Billing platform, MikroTik API provisioning, FreeRADIUS accounting, and automated M-Pesa billing integrations.
        </>
      }
      notes={["Jurisdiction: Republic of Kenya","Regulator: Communications Authority (CA)","Compliance: Kenya Data Protection Act 2019"]}
      sections={[
        {
          title: "Acceptance & Service Scope",
          body: (
            <>
              By creating an account, registering a tenant slug, connecting a MikroTik RouterOS device, or initiating subscriber billing on Suntech Billing (&quot;the Platform&quot;), you agree to be bound by these Terms. The platform provides software-as-a-service (SaaS) management tools for Internet Service Providers (ISPs), Wireless ISPs (WISPs), public hotspot venues, and enterprise carriers.
            </>
          ),
        },
        {
          title: "Hardware & Network Infrastructure",
          body: (
            <>
              Operators are solely responsible for maintaining legitimate, licensed access to their underlying network hardware (including MikroTik RouterOS routers, OLTs, switches, and wireless access points). Mashupkgrid provides software commands via native RouterOS API and FreeRADIUS RFC protocols; operators must ensure secure firewalling of Port 8728/8729 TLS and RADIUS ports.
            </>
          ),
        },
        {
          title: "Automated M-Pesa & Payment Processing",
          body: (
            <>
              Automated billing and STK push requests are transmitted via Safaricom Daraja 2.0 and accredited fintech payment gateways. Operators retain direct ownership of their Safaricom Paybill or Till numbers. Mashupkgrid does not take custody of operator funds; all customer payments flow directly from Safaricom into the operator&apos;s settlement bank or Paybill utility account.
            </>
          ),
        },
        {
          title: "Acceptable Use & Regulatory Compliance",
          body: (
            <>
              Operators agree not to utilize Suntech Billing to facilitate unlawful telecommunications activities, unauthorized lawful intercept bypasses, malicious denial-of-service (DDoS) reflection, or fraudulent SIM-box routing. Operators must maintain compliance with Communications Authority of Kenya (CA) guidelines and local regulatory licensing.
            </>
          ),
        },
        {
          title: "Service Level Agreement & Availability",
          body: (
            <>
              Mashupkgrid maintains a target platform uptime SLA of 99.98% across our core FreeRADIUS clusters and API endpoints. Maintenance windows are announced 48 hours in advance via the dashboard banner. Scheduled maintenance does not interrupt ongoing PPPoE data forwarding on subscriber routers.
            </>
          ),
        },
        {
          title: "Contact & Legal Notices",
          body: (
            <>
              For questions concerning these Terms, email legal@mashupkgrid.com or contact Mashupkgrid Telecom Technologies Ltd, Nairobi, Kenya.
            </>
          ),
        },
      ]}
    />
  );
}
