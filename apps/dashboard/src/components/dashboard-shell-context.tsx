"use client";

import { createContext, useContext } from "react";

export type Stats = { totalRequests: number; blockedRequests: number; discoveredEndpoints: number; shadowApis: number };
export type Domain = { id: string; hostname: string; status: string; errorMessage?: string | null };
export type Membership = { tenantId: string; name: string; slug: string; role: string };

export const emptyStats: Stats = { totalRequests: 0, blockedRequests: 0, discoveredEndpoints: 0, shadowApis: 0 };

export type RefreshIntervalKey = "stats" | "logs" | "endpoints" | "domains" | "cspm" | "itdr" | "security";
export type RefreshIntervals = Record<RefreshIntervalKey, number>;

export const DEFAULT_REFRESH_INTERVALS: RefreshIntervals = {
  stats: 15_000,
  logs: 15_000,
  endpoints: 15_000,
  domains: 15_000,
  cspm: 20_000,
  itdr: 20_000,
  security: 20_000,
};

export function mergeRefreshIntervals(overrides: Partial<Record<string, unknown>> | undefined): RefreshIntervals {
  const merged = { ...DEFAULT_REFRESH_INTERVALS };
  for (const key of Object.keys(merged) as RefreshIntervalKey[]) {
    const value = overrides?.[key];
    if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
  }
  return merged;
}

type ShellData = {
  stats: Stats;
  domains: Domain[];
  refreshDomains: () => void;
  activeTenantId: string;
  memberships: Membership[];
  refreshIntervals: RefreshIntervals;
};

export const DashboardShellContext = createContext<ShellData>({ stats: emptyStats, domains: [], refreshDomains: () => {}, activeTenantId: "", memberships: [], refreshIntervals: DEFAULT_REFRESH_INTERVALS });

export function useDashboardShell() {
  return useContext(DashboardShellContext);
}

export function describeDomainStatus(domains: Domain[]) {
  if (!domains.length) return { online: false, label: "Nenhum domínio cadastrado" };
  const active = domains.filter((domain) => domain.status === "active");
  if (active.length === domains.length) return { online: true, label: `${active.length} domínio${active.length === 1 ? "" : "s"} ativo${active.length === 1 ? "" : "s"}` };
  if (active.length > 0) return { online: true, label: `${active.length}/${domains.length} domínios ativos` };
  return { online: false, label: `${domains.length} domínio${domains.length === 1 ? "" : "s"} pendente${domains.length === 1 ? "" : "s"}` };
}
