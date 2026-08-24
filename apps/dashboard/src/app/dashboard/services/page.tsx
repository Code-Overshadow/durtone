"use client";

import Link from "next/link";
import { ArrowUpRight, ShieldCheck, UserCog, Zap } from "lucide-react";
import { apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useDashboardShell, describeDomainStatus } from "@/components/dashboard-shell-context";
import { SectionHeading, StatusTag } from "@/components/dashboard-ui";

type Config = { upstream: string; mode: string };
type HeartbeatStatus = "healthy" | "unhealthy" | "unknown";
type Heartbeat = { status: HeartbeatStatus; detail: Record<string, unknown>; lastError: string | null; updatedAt: string | null };
type ServicesHealth = {
  durtwall: Heartbeat;
  durtguardian: Heartbeat & { accounts: Array<{ status: string }> };
  durtscope: Heartbeat & { providers: Array<{ status: string }> };
};

export default function ServicesPage() {
  const { domains, refreshIntervals } = useDashboardShell();
  const configResource = usePollingResource(() => apiGet<Config>("/api/v1/config"), { intervalMs: refreshIntervals.stats });
  const healthResource = usePollingResource(() => apiGet<ServicesHealth>("/api/v1/services/health"), { intervalMs: refreshIntervals.stats });

  const domainStatus = describeDomainStatus(domains);
  const health = healthResource.data;
  const wafStatus = configResource.data ? `Upstream: ${configResource.data.upstream} · ${domainStatus.label}` : "Ainda não configurado";

  const accountsHealthy = health?.durtguardian.accounts.filter((account) => account.status === "healthy").length ?? 0;
  const accountsTotal = health?.durtguardian.accounts.length ?? 0;
  const providersHealthy = health?.durtscope.providers.filter((provider) => provider.status === "healthy").length ?? 0;
  const providersTotal = health?.durtscope.providers.length ?? 0;

  const tiles = [
    {
      href: "/dashboard/services/waf",
      icon: Zap,
      name: "DurtWall",
      description: "WAF, rate limiting e domínios gerenciados. Bloqueia OWASP Top 10 no tráfego do seu domínio antes de chegar no seu servidor.",
      status: wafStatus,
      health: health?.durtwall.status ?? "unknown" as HeartbeatStatus,
      error: health?.durtwall.lastError,
    },
    {
      href: "/dashboard/services/cspm",
      icon: ShieldCheck,
      name: "DurtGuardian",
      description: "CSPM multi-cloud. Conecte contas AWS, Azure ou GCP para varredura contínua de postura e detecção de drift.",
      status: accountsTotal ? `${accountsHealthy}/${accountsTotal} contas saudáveis` : "Nenhuma conta cloud ainda",
      health: accountsTotal === 0 ? "unknown" as HeartbeatStatus : health?.durtguardian.status ?? "unknown",
      error: health?.durtguardian.lastError,
    },
    {
      href: "/dashboard/services/itdr",
      icon: UserCog,
      name: "DurtScope",
      description: "ITDR de identidades. Conecte Keycloak, Okta, AWS IAM ou Google Workspace para inventário e revogação.",
      status: providersTotal ? `${providersHealthy}/${providersTotal} provedores saudáveis` : "Nenhum provedor conectado ainda",
      health: providersTotal === 0 ? "unknown" as HeartbeatStatus : health?.durtscope.status ?? "unknown",
      error: health?.durtscope.lastError,
    },
  ];

  return <div className="content">
    <SectionHeading kicker="SERVIÇOS" title="Módulos do DurtOne" description="Cada serviço roda de forma independente e gerenciada — clique para configurar." />
    <div className="service-grid">
      {tiles.map(({ href, icon: Icon, name, description, status, health: tileHealth, error }) => <Link key={href} href={href} className="service-tile">
        <span className="service-tile-icon"><Icon size={20} /></span>
        <h3>{name}<StatusTag status={tileHealth} title={error ?? undefined} /></h3>
        <p>{description}</p>
        <div className="service-tile-footer"><span>{status}</span><ArrowUpRight size={14} /></div>
      </Link>)}
    </div>
  </div>;
}
