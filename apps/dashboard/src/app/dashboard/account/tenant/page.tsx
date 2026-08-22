"use client";

import { FormEvent } from "react";
import { AlertTriangle, Save } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api/client";
import { useEditableResource } from "@/hooks/use-editable-resource";
import { DEFAULT_REFRESH_INTERVALS, mergeRefreshIntervals, type RefreshIntervalKey } from "@/components/dashboard-shell-context";
import { EmptyState, SectionHeading } from "@/components/dashboard-ui";

type Tenant = { id: string; name: string; slug: string; createdAt: string; settings: { refreshIntervals?: Partial<Record<RefreshIntervalKey, number>> } };

const REFRESH_LABELS: Record<RefreshIntervalKey, string> = {
  stats: "Visão geral",
  logs: "Eventos (logs)",
  endpoints: "Superfície de API",
  domains: "Domínios",
  cspm: "DurtGuardian (CSPM)",
  itdr: "DurtScope (ITDR)",
  security: "Security Score",
};

export default function TenantSettingsPage() {
  const resource = useEditableResource<Tenant>({
    fetcher: () => apiGet<Tenant>("/api/v1/tenant"),
    saver: (value) => apiPut<Tenant>("/api/v1/tenant", { name: value.name, refreshIntervals: value.settings.refreshIntervals }),
  });
  const { value: tenant, dirty, status, error, update, discard, save } = resource;

  if (!tenant) return <div className="content settings-content"><EmptyState label="Carregando tenant..." /></div>;

  const intervals = mergeRefreshIntervals(tenant.settings.refreshIntervals);

  function setInterval(key: RefreshIntervalKey, seconds: number) {
    update((current) => ({ ...current, settings: { ...current.settings, refreshIntervals: { ...mergeRefreshIntervals(current.settings.refreshIntervals), [key]: Math.round(seconds * 1000) } } }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save();
  }

  return <div className="content settings-content">
    <SectionHeading kicker="WORKSPACE" title="Tenant" description="Identidade do workspace exibida no dashboard e nos relatórios." />
    <form className="panel settings-panel" onSubmit={submit}>
      <label>Nome do tenant<input value={tenant.name} onChange={(event) => update({ name: event.target.value })} required /></label>
      <label>Slug <span className="optional">imutável</span><input value={tenant.slug} disabled /></label>
      <label>Criado em <span className="optional">somente leitura</span><input value={new Date(tenant.createdAt).toLocaleDateString("pt-BR")} disabled /></label>

      <div>
        <span className="field-label">Intervalo de atualização (segundos)</span>
        <p className="muted" style={{ margin: "4px 0 14px" }}>Com que frequência cada tela busca dados novos automaticamente. Entre 5s e 300s.</p>
        <div className="inline-form" style={{ margin: 0, boxShadow: "none", border: "1px solid var(--line)" }}>
          <div className="form-grid">
            {(Object.keys(REFRESH_LABELS) as RefreshIntervalKey[]).map((key) => <label key={key}>{REFRESH_LABELS[key]}
              <input type="number" min={5} max={300} step={1} value={Math.round(intervals[key] / 1000)} onChange={(event) => setInterval(key, Number(event.target.value) || DEFAULT_REFRESH_INTERVALS[key] / 1000)} />
            </label>)}
          </div>
        </div>
      </div>

      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <div className="form-actions">
        <span className="muted">{dirty ? "Alterações não salvas." : "Tenant sincronizado."}</span>
        {dirty && <button className="text-button" type="button" onClick={discard}>Descartar</button>}
        <button className="primary-button" type="submit" disabled={status === "saving"}><Save size={16} /> {status === "saving" ? "Salvando..." : "Salvar tenant"}</button>
      </div>
    </form>
  </div>;
}
