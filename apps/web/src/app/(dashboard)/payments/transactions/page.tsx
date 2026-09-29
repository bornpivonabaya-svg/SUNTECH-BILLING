"use client";

import { Panel, PaymentsWorkspace, TENANT_TABS } from "@/components/payments-gateway/kit";
import { TransactionsView } from "@/components/payments-gateway/lists";

export default function PaymentsTransactionsPage() {
  return (
    <PaymentsWorkspace
      tabs={TENANT_TABS}
      title="Transactions"
      description="Every payment collected for you through the Suntech gateway: what the customer paid, the platform fee, and what you receive."
    >
      <Panel padded={false}>
        <TransactionsView endpointBase="/api/v1/tenant-payments" />
      </Panel>
    </PaymentsWorkspace>
  );
}
