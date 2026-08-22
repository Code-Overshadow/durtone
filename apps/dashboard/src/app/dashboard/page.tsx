"use client";

import Link from "next/link";
import { Activity, AlertTriangle, ArrowUpRight, Shield, Terminal } from "lucide-react";
import { apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { useDashboardShell } from "@/components/dashboard-shell-context";
import { EmptyState, Metric } from "@/components/dashboard-ui";

type RequestLog = { id: string; method: string; path: string; status: number; remoteIp: string; blocked: boolean; timestamp: string };
type Endpoint = { method: string; path: string; count: number; documented: boolean; shadow: boolean };

export default function OverviewPage() {
  const { stats, refreshIntervals } = useDashboardShell();
  const logsResource = usePollingResource(() => apiGet<{ logs: RequestLog[] }>("/api/v1/logs"), { intervalMs: refreshIntervals.logs });
  const endpointsResource = usePollingResource(() => apiGet<{ endpoints: Endpoint[] }>("/api/v1/endpoints"), { intervalMs: refreshIntervals.endpoints });
  useRefreshable(() => { void logsResource.refresh(); void endpointsResource.refresh(); });

  const logs = logsResource.data?.logs ?? [];
  const endpoints = endpointsResource.data?.endpoints ?? [];

  return <div className="content">
    <section className="hero-strip">
      <div><span className="section-kicker">POSTURA DO AMBIENTE</span><h2>Visibilidade sem ruído.</h2><p>Seu perímetro está sendo observado continuamente pelo DurtWall.</p></div>
      <div className="hero-score"><span>Proteção ativa</span><strong>{stats.totalRequests ? `${Math.round((1 - stats.blockedRequests / stats.totalRequests) * 100)}%` : "--"}</strong><small>tráfego permitido</small></div>
    </section>
    <div className="metric-grid">
      <Metric label="Requisições" value={stats.totalRequests} delta="janela atual" icon={Activity} />
      <Metric label="Bloqueios WAF" value={stats.blockedRequests} delta="ameaças contidas" icon={Shield} accent="coral" />
      <Metric label="Endpoints" value={stats.discoveredEndpoints} delta="superfície observada" icon={Terminal} />
      <Metric label="Shadow APIs" value={stats.shadowApis} delta={stats.shadowApis ? "requer atenção" : "nenhum alerta"} icon={AlertTriangle} accent={stats.shadowApis ? "coral" : "mint"} />
    </div>
    <div className="section-heading">
      <div><span className="section-kicker">ATIVIDADE RECENTE</span><h3>O que está acontecendo</h3></div>
      <Link className="text-button" href="/dashboard/logs">Ver todos <ArrowUpRight size={14} /></Link>
    </div>
    <div className="lower-grid">
      <div className="panel event-panel">{logs.length ? logs.slice(0, 5).map((log) => <EventRow key={log.id} log={log} />) : <EmptyState label="Nenhum evento recebido ainda" />}</div>
      <div className="panel surface-panel">
        <div className="panel-heading"><span>Superfície API</span><Link className="icon-button" href="/dashboard/surface" aria-label="Abrir superfície"><ArrowUpRight size={16} /></Link></div>
        {endpoints.length ? endpoints.slice(0, 4).map((endpoint) => <div className="surface-row" key={`${endpoint.method}-${endpoint.path}`}><span className={`method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</span><code>{endpoint.path}</code><span className={endpoint.shadow ? "status-tag shadow" : "status-tag documented"}>{endpoint.shadow ? "shadow" : "documentado"}</span></div>) : <EmptyState label="Aguardando descoberta de endpoints" />}
      </div>
    </div>
  </div>;
}

function EventRow({ log }: { log: RequestLog }) {
  return <div className="event-row"><span className={log.blocked ? "event-dot blocked" : "event-dot"} /><div className="event-main"><strong>{log.blocked ? "Requisição bloqueada" : "Requisição observada"}</strong><code>{log.method} {log.path}</code></div><span className={log.blocked ? "status-code blocked" : "status-code"}>{log.status}</span><time>{new Date(log.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></div>;
}
