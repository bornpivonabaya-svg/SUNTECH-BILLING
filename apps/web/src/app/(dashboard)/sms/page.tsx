"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Button, Card, ErrorText, HintText, Input, Label, Badge, StatusDot } from "@/components/ui";

interface SmsConfigStatus {
  configured: boolean;
  isActive: boolean;
  username: string | null;
  senderId: string | null;
  environment: string;
  sendVoucherSms: boolean;
}

export default function SmsGatewayPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [senderId, setSenderId] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [error, setError] = useState<string | null>(null);
  // Read-only until focused: browsers otherwise fill these with the dashboard login, and saving
  // would store the owner's email and password as SMS credentials.
  const [unlocked, setUnlocked] = useState({ username: false, apiKey: false });

  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("This is a test message from Suntech Billing.");
  const [testResult, setTestResult] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["sms-config"],
    queryFn: () => apiFetch<SmsConfigStatus>("/api/v1/sms/config"),
  });

  const saveConfig = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/sms/config", {
        method: "PUT",
        body: JSON.stringify({ apiKey, username, senderId: senderId || undefined, environment }),
      }),
    onSuccess: () => {
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["sms-config"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to save configuration"),
  });

  const setVoucherTexts = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch<SmsConfigStatus>("/api/v1/sms/config/voucher-texts", { method: "PUT", body: JSON.stringify({ enabled }) }),
    onSuccess: (next) => queryClient.setQueryData(["sms-config"], next),
  });

  const sendTest = useMutation({
    mutationFn: () =>
      apiFetch<{ delivered: boolean; reason?: string }>("/api/v1/sms/send-test", {
        method: "POST",
        body: JSON.stringify({ phone: testPhone, message: testMessage }),
      }),
    onSuccess: (result) => {
      setTestResult(
        result.delivered ? "Sent successfully." : `Not delivered: ${result.reason ?? "unknown reason"}`
      );
    },
    onError: (err) => setTestResult(err instanceof ApiRequestError ? err.message : "Failed to send test message"),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            SMS gateway
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Africa&apos;s Talking Bulk SMS — used for payment reminders, overdue notices, hotspot voucher codes and router alerts.
          </p>
        </div>
        {status?.configured && (
          <Badge variant={status.isActive ? "success" : "warning"}>
            <StatusDot status={status.isActive ? "ONLINE" : "WARNING"} />
            <span>{status.environment.toUpperCase()} · {status.username}</span>
          </Badge>
        )}
      </div>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900 dark:text-white">Africa&apos;s Talking Credentials</h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          From your Africa&apos;s Talking dashboard. The API key is encrypted at rest and never shown again.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            saveConfig.mutate();
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="off" data-1p-ignore data-lpignore="true" readOnly={!unlocked.username} onFocus={() => setUnlocked((u) => ({ ...u, username: true }))} value={username} onChange={(e) => setUsername(e.target.value)} required />
            <HintText>Use &quot;sandbox&quot; for the sandbox environment.</HintText>
          </div>
          <div>
            <Label htmlFor="apiKey">API Key</Label>
            <Input id="apiKey" type="password" autoComplete="new-password" data-1p-ignore data-lpignore="true" readOnly={!unlocked.apiKey} onFocus={() => setUnlocked((u) => ({ ...u, apiKey: true }))} value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="senderId">Sender ID (optional)</Label>
            <Input id="senderId" value={senderId} onChange={(e) => setSenderId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="environment">Environment</Label>
            <select
              id="environment"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as "sandbox" | "production")}
            >
              <option value="sandbox">Sandbox (testing)</option>
              <option value="production">Production (live)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saveConfig.isPending}>
              {saveConfig.isPending ? "Saving..." : "Save configuration"}
            </Button>
          </div>
        </form>
        {error && <ErrorText>{error}</ErrorText>}
      </Card>

      {status?.configured && (
        <Card>
          <h2 className="mb-3 font-semibold text-slate-900 dark:text-white">Automatic texts</h2>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={status.sendVoucherSms}
              disabled={setVoucherTexts.isPending}
              onChange={(e) => setVoucherTexts.mutate(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-white">Text hotspot buyers their voucher code</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Sent after each M-Pesa purchase, so a customer who drops off the Wi-Fi can still log in. Uses one SMS of your credit per sale.
              </span>
            </span>
          </label>
          {setVoucherTexts.isError && <ErrorText>Couldn&apos;t save. Try again.</ErrorText>}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Router down and back-online alerts go to staff who manage routers and have a phone number on their profile.
          </p>
        </Card>
      )}

      {status?.configured && (
        <Card>
          <h2 className="mb-3 font-semibold text-slate-900 dark:text-white">Send a test message</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setTestResult(null);
              sendTest.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="testPhone">Phone number</Label>
              <Input
                id="testPhone"
                placeholder="0712345678"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="testMessage">Message</Label>
              <Input id="testMessage" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} required />
            </div>
            <Button type="submit" disabled={sendTest.isPending}>
              {sendTest.isPending ? "Sending..." : "Send test"}
            </Button>
            {testResult && <p className="text-sm text-slate-600 dark:text-slate-400">{testResult}</p>}
          </form>
        </Card>
      )}
    </div>
  );
}
