"use client";

import { CheckCircle2, AlertTriangle, Gauge, Shield } from "lucide-react";
import { apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { EmptyState, Metric, SectionHeading } from "@/components/dashboard-ui";

type CspmDrift = { kind: "changed" | "new" | "missing"; resource: string; before?: string; after?: string };
type CspmSummary = { provider: string; accountId: string; postureScore: number; totalChecks: number; passChecks: number; failChecks: number; criticalFindings: number; driftCount: number; lastScanAt: string; drifts: CspmDrift[] };

const emptySummary: CspmSummary = { provider: "aws", accountId: "n/a", postureScore: 0, totalChecks: 0, passChecks: 0, failChecks: 0, criticalFindings: 0, driftCount: 0, lastScanAt: new Date(0).toISOString(), drifts: [] };

export default function CspmPage() {
  const cspmResource = usePollingResource(() => apiGet<CspmSummary>("/api/v1/cspm/summary"));
  useRefreshable(() => void cspmResource.refresh());
  const metrics = cspmResource.data ?? emptySummary;

  return <div className="content">
    <SectionHeading kicker="DURTGUARDIAN" title="CSPM e drift" count={`${metrics.provider}/${metrics.accountId}`} />
    <div className="metric-grid">
      <Metric label="Postura" value={metrics.postureScore} delta="score global" icon={Gauge} accent="teal" />
      <Metric label="Checks" value={metrics.totalChecks} delta={`${metrics.passChecks} OK`} icon={CheckCircle2} accent="mint" />
      <Metric label="Falhas" value={metrics.failChecks} delta={`${metrics.criticalFindings} críticas`} icon={AlertTriangle} accent="coral" />
      <Metric label="Drifts" value={metrics.driftCount} delta="mudanças detectadas" icon={Shield} accent="yellow" />
    </div>
    <div className="panel table-panel">
      <div className="table-head"><span>Recurso</span><span>Tipo</span><span>Antes</span><span>Depois</span></div>
      {metrics.drifts.length ? metrics.drifts.map((drift) => <div className="table-row" key={`${drift.resource}-${drift.kind}`}>
        <div className="event-main"><strong>{drift.resource}</strong><code>{new Date(metrics.lastScanAt).toLocaleString("pt-BR")}</code></div>
        <span className={drift.kind === "new" ? "status-tag shadow" : drift.kind === "missing" ? "status-tag documented" : "status-tag"}>{drift.kind}</span>
        <span>{drift.before ?? "—"}</span>
        <span>{drift.after ?? "—"}</span>
      </div>) : <EmptyState label="Sem drifts detectados" />}
    </div>
  </div>;
}
