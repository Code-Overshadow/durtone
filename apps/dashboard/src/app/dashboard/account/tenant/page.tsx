"use client";

import { FormEvent } from "react";
import { AlertTriangle, Save } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api/client";
import { useEditableResource } from "@/hooks/use-editable-resource";
import { EmptyState, SectionHeading } from "@/components/dashboard-ui";

type Tenant = { id: string; name: string; slug: string; createdAt: string };

export default function TenantSettingsPage() {
  const resource = useEditableResource<Tenant>({
    fetcher: () => apiGet<Tenant>("/api/v1/tenant"),
    saver: (value) => apiPut<Tenant>("/api/v1/tenant", { name: value.name }),
  });
  const { value: tenant, dirty, status, error, update, discard, save } = resource;

  if (!tenant) return <div className="content settings-content"><EmptyState label="Carregando tenant..." /></div>;

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
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <div className="form-actions">
        <span className="muted">{dirty ? "Alterações não salvas." : "Tenant sincronizado."}</span>
        {dirty && <button className="text-button" type="button" onClick={discard}>Descartar</button>}
        <button className="primary-button" type="submit" disabled={status === "saving"}><Save size={16} /> {status === "saving" ? "Salvando..." : "Salvar tenant"}</button>
      </div>
    </form>
  </div>;
}
