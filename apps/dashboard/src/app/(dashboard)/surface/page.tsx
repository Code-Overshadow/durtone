"use client";

import { apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { EmptyState, SectionHeading } from "@/components/dashboard-ui";

type Endpoint = { method: string; path: string; count: number; documented: boolean; shadow: boolean };

export default function SurfacePage() {
  const endpointsResource = usePollingResource(() => apiGet<{ endpoints: Endpoint[] }>("/api/v1/endpoints"));
  useRefreshable(() => void endpointsResource.refresh());
  const endpoints = endpointsResource.data?.endpoints ?? [];

  return <div className="content">
    <SectionHeading kicker="DURTSHIELD" title="Superfície de API" count={`${endpoints.filter((endpoint) => endpoint.shadow).length} shadow`} />
    <div className="panel table-panel">
      <div className="table-head surface-head"><span>Endpoint</span><span>Acessos</span><span>Status</span></div>
      {endpoints.length ? endpoints.map((endpoint) => <div className="table-row surface-table-row" key={`${endpoint.method}-${endpoint.path}`}>
        <div><span className={`method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</span><code>{endpoint.path}</code></div>
        <span>{endpoint.count.toLocaleString("pt-BR")}</span>
        <span className={endpoint.shadow ? "status-tag shadow" : "status-tag documented"}>{endpoint.shadow ? "Shadow API" : "Documentado"}</span>
      </div>) : <EmptyState label="Nenhum endpoint descoberto" />}
    </div>
  </div>;
}
