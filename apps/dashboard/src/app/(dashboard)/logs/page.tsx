"use client";

import { apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { EmptyState, SectionHeading } from "@/components/dashboard-ui";

type RequestLog = { id: string; method: string; path: string; status: number; remoteIp: string; blocked: boolean; timestamp: string };

export default function LogsPage() {
  const logsResource = usePollingResource(() => apiGet<{ logs: RequestLog[] }>("/api/v1/logs"));
  useRefreshable(() => void logsResource.refresh());
  const logs = logsResource.data?.logs ?? [];

  return <div className="content">
    <SectionHeading kicker="TRÁFEGO" title="Eventos do perímetro" count={`${logs.length} eventos`} />
    <div className="panel table-panel">
      <div className="table-head"><span>Evento</span><span>Origem</span><span>Status</span><span>Horário</span></div>
      {logs.length ? logs.map((log) => <div className="table-row" key={log.id}>
        <div className="event-main"><strong>{log.blocked ? "Bloqueado pelo WAF" : "Tráfego permitido"}</strong><code>{log.method} {log.path}</code></div>
        <span>{log.remoteIp}</span>
        <span className={log.blocked ? "status-code blocked" : "status-code"}>{log.status}</span>
        <time>{new Date(log.timestamp).toLocaleString("pt-BR")}</time>
      </div>) : <EmptyState label="Nenhum log disponível" />}
    </div>
  </div>;
}
