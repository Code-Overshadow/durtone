"use client";

import Link from "next/link";
import { ArrowUpRight, Globe, ShieldCheck, UserCog, Zap } from "lucide-react";
import { apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useDashboardShell, describeDomainStatus } from "@/components/dashboard-shell-context";
import { SectionHeading } from "@/components/dashboard-ui";

type Config = { upstream: string; mode: string };
type CloudAccount = { enabled: boolean };
type IdentityProvider = { enabled: boolean };

export default function ServicesPage() {
  const { domains, refreshIntervals } = useDashboardShell();
  const configResource = usePollingResource(() => apiGet<Config>("/api/v1/config"), { intervalMs: refreshIntervals.stats });
  const cloudAccountsResource = usePollingResource(() => apiGet<{ accounts: CloudAccount[] }>("/api/v1/cloud-accounts"), { intervalMs: refreshIntervals.cspm });
  const providersResource = usePollingResource(() => apiGet<{ providers: IdentityProvider[] }>("/api/v1/identity-providers"), { intervalMs: refreshIntervals.itdr });

  const domainStatus = describeDomainStatus(domains);
  const cloudAccounts = cloudAccountsResource.data?.accounts ?? [];
  const providers = providersResource.data?.providers ?? [];
  const enabledAccounts = cloudAccounts.filter((account) => account.enabled).length;
  const enabledProviders = providers.filter((provider) => provider.enabled).length;

  const tiles = [
    {
      href: "/dashboard/services/waf",
      icon: Zap,
      name: "DurtWall",
      description: "WAF e rate limiting gerenciados. Bloqueia OWASP Top 10 no tráfego do seu domínio antes de chegar no seu servidor.",
      status: configResource.data ? `Upstream: ${configResource.data.upstream}` : "Ainda não configurado",
    },
    {
      href: "/dashboard/services/domains",
      icon: Globe,
      name: "Domínios",
      description: "Domínios protegidos pelo DurtWall. Aponte um CNAME e o certificado TLS é emitido automaticamente.",
      status: domainStatus.label,
    },
    {
      href: "/dashboard/services/cspm",
      icon: ShieldCheck,
      name: "DurtGuardian",
      description: "CSPM multi-cloud. Conecte contas AWS, Azure ou GCP para varredura contínua de postura e detecção de drift.",
      status: cloudAccounts.length ? `${enabledAccounts}/${cloudAccounts.length} contas ativas` : "Nenhuma conta cloud ainda",
    },
    {
      href: "/dashboard/services/itdr",
      icon: UserCog,
      name: "DurtScope",
      description: "ITDR de identidades. Conecte Keycloak, Okta, AWS IAM ou Google Workspace para inventário e revogação.",
      status: providers.length ? `${enabledProviders}/${providers.length} provedores ativos` : "Nenhum provedor conectado ainda",
    },
  ];

  return <div className="content">
    <SectionHeading kicker="SERVIÇOS" title="Módulos do DurtOne" description="Cada serviço roda de forma independente e gerenciada — clique para configurar." />
    <div className="service-grid">
      {tiles.map(({ href, icon: Icon, name, description, status }) => <Link key={href} href={href} className="service-tile">
        <span className="service-tile-icon"><Icon size={20} /></span>
        <h3>{name}</h3>
        <p>{description}</p>
        <div className="service-tile-footer"><span>{status}</span><ArrowUpRight size={14} /></div>
      </Link>)}
    </div>
  </div>;
}
