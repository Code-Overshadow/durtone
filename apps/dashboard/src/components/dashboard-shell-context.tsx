"use client";

import { createContext, useContext } from "react";

export type Stats = { totalRequests: number; blockedRequests: number; discoveredEndpoints: number; shadowApis: number };
export type Domain = { id: string; hostname: string; status: string; errorMessage?: string | null };

export const emptyStats: Stats = { totalRequests: 0, blockedRequests: 0, discoveredEndpoints: 0, shadowApis: 0 };

type ShellData = {
  stats: Stats;
  domains: Domain[];
  refreshDomains: () => void;
};

export const DashboardShellContext = createContext<ShellData>({ stats: emptyStats, domains: [], refreshDomains: () => {} });

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
