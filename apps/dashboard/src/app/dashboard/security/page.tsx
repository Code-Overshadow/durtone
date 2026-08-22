"use client";

import { Activity, Gauge, Shield } from "lucide-react";
import { apiDownload, apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { EmptyState, Metric, SectionHeading } from "@/components/dashboard-ui";

type SecurityScore = { score: number; components: { waf: number; cspm: number; itdr: number }; weights: { waf: number; cspm: number; itdr: number } };
type CorrelationResult = { action: string; matches?: Array<{ name: string }>; attack?: { path?: string; remoteIp?: string }; change?: { resource?: string; kind?: string } };
type Correlation = { id: string; source: string; result: CorrelationResult; createdAt: string };

const emptyScore: SecurityScore = { score: 0, components: { waf: 0, cspm: 0, itdr: 0 }, weights: { waf: 0.4, cspm: 0.3, itdr: 0.3 } };

function describeCorrelation(correlation: Correlation) {
  const { result } = correlation;
  if (result.attack) return { detail: `${result.attack.remoteIp ?? "IP desconhecido"} → ${result.attack.path ?? ""}`, origin: "DurtWall" };
  if (result.change) return { detail: `${result.change.resource ?? "recurso"} (${result.change.kind ?? "changed"})`, origin: "DurtGuardian" };
  return { detail: "—", origin: correlation.source };
}

export default function SecurityPage() {
  const securityScoreResource = usePollingResource(() => apiGet<SecurityScore>("/api/v1/security/score"));
  const correlationsResource = usePollingResource(() => apiGet<{ correlations: Correlation[] }>("/api/v1/security/correlations"));
  useRefreshable(() => { void securityScoreResource.refresh(); void correlationsResource.refresh(); });

  const current = securityScoreResource.data ?? emptyScore;
  const correlations = correlationsResource.data?.correlations ?? [];

  async function downloadReport() {
    try {
      const blob = await apiDownload("/api/v1/security/report.pdf");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "durtone-security-report.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // best-effort download; no dedicated error surface for this action yet
    }
  }

  return <div className="content">
    <SectionHeading kicker="CORRELAÇÃO" title="Security Score unificado" description="WAF, postura cloud e higiene de identidades em uma única leitura." actions={<button className="primary-button" onClick={downloadReport}>Baixar relatório</button>} />
    <section className="hero-strip">
      <div><span className="section-kicker">POSTURA GERAL</span><h2>{current.score}/100</h2><p>Score calculado a partir da telemetria mais recente.</p></div>
      <div className="hero-score"><span>Prioridade</span><strong>{current.score < 60 ? "Alta" : current.score < 80 ? "Média" : "Baixa"}</strong><small>risco agregado</small></div>
    </section>
    <div className="metric-grid">
      <Metric label="DurtWall" value={current.components.waf} delta="eficácia WAF" icon={Shield} accent="teal" />
      <Metric label="DurtGuardian" value={current.components.cspm} delta="postura CSPM" icon={Gauge} accent="mint" />
      <Metric label="DurtScope" value={current.components.itdr} delta="higiene ITDR" icon={Activity} accent="yellow" />
    </div>
    <SectionHeading kicker="RESPOSTA A INCIDENTES" title="Correlações detectadas" count={`${correlations.length} recentes`} />
    <div className="panel table-panel">
      <div className="table-head"><span>Origem / detalhe</span><span>Ação</span><span>Identidades</span><span>Horário</span></div>
      {correlations.length ? correlations.map((correlation) => {
        const { detail, origin } = describeCorrelation(correlation);
        const matches = correlation.result.matches ?? [];
        return <div className="table-row" key={correlation.id}>
          <div className="event-main"><strong>{origin}</strong><code>{detail}</code></div>
          <span className={correlation.result.action.startsWith("revoke") || correlation.result.action === "audit-identity" ? "status-tag shadow" : "status-tag"}>{correlation.result.action}</span>
          <span>{matches.length ? matches.map((match) => match.name).join(", ") : "—"}</span>
          <time>{new Date(correlation.createdAt).toLocaleString("pt-BR")}</time>
        </div>;
      }) : <EmptyState label="Nenhuma correlação detectada ainda" />}
    </div>
  </div>;
}
