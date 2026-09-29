"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api-client";

/** The captive portal's address as the API is configured (APP_PORTAL_URL), never a hardcoded
 *  domain. Falls back to this site while loading or if the API can't say. */
export function usePortalBase(): string {
  const { data } = useQuery({
    queryKey: ["public-config"],
    queryFn: () => apiFetch<{ portalUrl: string }>("/api/v1/public/config", { skipAuth: true }),
    staleTime: 10 * 60 * 1000,
  });
  if (typeof window === "undefined") return data?.portalUrl ?? "";
  // Local development serves the portal from this app.
  if (/^(localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3})$/.test(window.location.hostname)) return window.location.origin;
  return data?.portalUrl || window.location.origin;
}
