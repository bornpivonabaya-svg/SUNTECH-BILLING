import { LegalShell } from "@/components/marketing/legal-shell";

export default function AgePolicyPage() {
  return (
    <LegalShell
      active="/age-policy"
      category="Child Online Safety & Age Policy"
      effective="August 28, 2026"
      title="Age Verification & Protection Policy"
      intro={
        <>
          Our standards regarding minimum age eligibility for account holders, parental authority, data privacy safeguards for minors, and child online protection.
        </>
      }
      notes={["Minimum Account Age: 18 Years","Parental DNS Controls Supported","Child Online Protection (COP)"]}
      sections={[
        {
          title: "Minimum Age Eligibility (18+)",
          body: (
            <>
              To register an operator console account, sign a telecommunications broadband subscription agreement, or initiate recurring M-Pesa billing on Suntech Billing, users must be at least 18 years of age (the legal age of majority in the Republic of Kenya) or have explicit contractual authorization from a parent or legal guardian.
            </>
          ),
        },
        {
          title: "Protection of Minors on Broadband Networks",
          body: (
            <>
              While minors frequently access home fiber and public Wi-Fi networks managed through Mashupkgrid routers, our platform does not knowingly collect personal identifying information (PII) directly from children under 13 years of age. All subscriber contracts and billing records are registered under the adult account holder&apos;s name.
            </>
          ),
        },
        {
          title: "Parental Controls & Family Filtering",
          body: (
            <>
              Suntech Billing enables operators to provision family-safe DNS profiles (such as Cloudflare 1.1.1.3 Family Protection or CleanBrowsing Adult Filter) directly through MikroTik DHCP server and RADIUS attribute configuration. Parents and guardians may request family-safe speed profiles on their residential PPPoE line.
            </>
          ),
        },
        {
          title: "Kenya Data Protection Act Compliance",
          body: (
            <>
              Pursuant to Section 33 of the Kenya Data Protection Act 2019, any processing of personal data relating to minors requires verifiable consent from their parent or guardian. If an operator discovers that an unauthorized minor has created an account without parental consent, the account is terminated and associated records expunged.
            </>
          ),
        },
        {
          title: "Inquiries & Parental Requests",
          body: (
            <>
              Parents or guardians with questions regarding parental controls, content filtering, or minor data deletion may contact our Data Protection Officer at privacy@mashupkgrid.com.
            </>
          ),
        },
      ]}
    />
  );
}
