"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Plus, Trash2, Users } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { EmptyState, HelpCallout, SectionHeading, ServiceBackLink } from "@/components/dashboard-ui";

type IdentityProvider = { id: string; kind: string; displayName: string; baseUrl: string | null; realmOrTenant: string | null; region: string | null; clientId: string | null; enabled: boolean };
type Kind = "keycloak" | "okta" | "aws" | "google";

const emptyForm = { kind: "keycloak" as Kind, displayName: "", baseUrl: "", realmOrTenant: "", region: "us-east-1", clientId: "", clientSecret: "", apiToken: "", accessKeyId: "", secretAccessKey: "", accessToken: "" };

function buildCredential(form: typeof emptyForm) {
  if (form.kind === "keycloak") return { clientSecret: form.clientSecret };
  if (form.kind === "okta") return { apiToken: form.apiToken };
  if (form.kind === "aws") return { accessKeyId: form.accessKeyId, secretAccessKey: form.secretAccessKey };
  return { accessToken: form.accessToken };
}

const KIND_LABEL: Record<string, string> = { keycloak: "Keycloak", okta: "Okta", aws: "AWS IAM", google: "Google Workspace" };

export default function ItdrSettingsPage() {
  const providersResource = usePollingResource(() => apiGet<{ providers: IdentityProvider[] }>("/api/v1/identity-providers"));
  useRefreshable(() => void providersResource.refresh());
  const providers = providersResource.data?.providers ?? [];

  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/v1/identity-providers", {
        kind: form.kind,
        displayName: form.displayName.trim(),
        baseUrl: form.baseUrl.trim() || undefined,
        realmOrTenant: form.realmOrTenant.trim() || undefined,
        region: form.kind === "aws" ? form.region.trim() : undefined,
        clientId: form.kind === "keycloak" ? form.clientId.trim() : undefined,
        credential: buildCredential(form),
      });
      setForm(emptyForm);
      void providersResource.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível cadastrar o provedor de identidade");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(provider: IdentityProvider) {
    await apiPut(`/api/v1/identity-providers/${provider.id}`, {
      displayName: provider.displayName,
      baseUrl: provider.baseUrl ?? undefined,
      realmOrTenant: provider.realmOrTenant ?? undefined,
      region: provider.region ?? undefined,
      clientId: provider.clientId ?? undefined,
      enabled: !provider.enabled,
    });
    void providersResource.refresh();
  }

  async function remove(id: string) {
    await apiDelete(`/api/v1/identity-providers/${id}`);
    void providersResource.refresh();
  }

  return <div className="content settings-content">
    <ServiceBackLink />
    <SectionHeading kicker="DURTSCOPE" title="Provedores de identidade" description="Conectores que o DurtScope consulta para inventariar identidades humanas e de serviço." />
    <HelpCallout title="O que o DurtScope faz">
      Conecta no seu provedor de identidade (Keycloak, Okta, AWS IAM ou Google Workspace) pra listar contas humanas e de serviço, calcular um risco por identidade e permitir revogação real quando algo parecer comprometido ou obsoleto.
    </HelpCallout>
    <form className="inline-form" onSubmit={submit}>
      <div className="form-grid">
        <label>Provider<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as Kind })}>
          <option value="keycloak">Keycloak</option><option value="okta">Okta</option><option value="aws">AWS IAM</option><option value="google">Google Workspace</option>
        </select></label>
        <label>Nome de exibição<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /></label>
        {form.kind !== "aws" && <label>Base URL<input type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://identity.example.com" required={form.kind !== "google"} /></label>}
        {form.kind === "aws" && <label>Região<input value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} required /></label>}
        {form.kind === "keycloak" && <><label>Realm<input value={form.realmOrTenant} onChange={(event) => setForm({ ...form, realmOrTenant: event.target.value })} required /></label><label>Client ID<input value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} required /></label></>}
        {form.kind === "google" && <label>Customer ID<input value={form.realmOrTenant} onChange={(event) => setForm({ ...form, realmOrTenant: event.target.value })} placeholder="my_customer" /></label>}
        {form.kind === "keycloak" && <label>Client secret<input type="password" value={form.clientSecret} onChange={(event) => setForm({ ...form, clientSecret: event.target.value })} autoComplete="new-password" required /></label>}
        {form.kind === "okta" && <label>API token<input type="password" value={form.apiToken} onChange={(event) => setForm({ ...form, apiToken: event.target.value })} autoComplete="new-password" required /></label>}
        {form.kind === "aws" && <><label>Access key ID<input value={form.accessKeyId} onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })} autoComplete="off" required /></label><label>Secret access key<input type="password" value={form.secretAccessKey} onChange={(event) => setForm({ ...form, secretAccessKey: event.target.value })} autoComplete="new-password" required /></label></>}
        {form.kind === "google" && <label>Access token<input type="password" value={form.accessToken} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} autoComplete="new-password" required /></label>}
      </div>
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <div className="form-actions"><span className="muted">Credenciais são cifradas antes de persistir e nunca retornam nas respostas.</span><button className="primary-button" type="submit" disabled={busy}><Plus size={16} /> {busy ? "Cadastrando..." : "Adicionar provedor"}</button></div>
    </form>
    <div className="resource-list">
      {providers.length ? providers.map((provider) => <div className="resource-card" key={provider.id}>
        <div><strong><Users size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />{provider.displayName}</strong><small>{KIND_LABEL[provider.kind] ?? provider.kind}{provider.realmOrTenant ? ` · ${provider.realmOrTenant}` : ""}</small></div>
        <span className={provider.enabled ? "status-tag enabled" : "status-tag disabled"}>{provider.enabled ? "Ativo" : "Pausado"}</span>
        <div className="resource-actions">
          <button className="ghost-button" onClick={() => void toggle(provider)}>{provider.enabled ? "Pausar" : "Reativar"}</button>
          <button className="danger-button" onClick={() => void remove(provider.id)}><Trash2 size={13} /> Remover</button>
        </div>
      </div>) : <EmptyState label="Nenhum provedor de identidade cadastrado ainda" />}
    </div>
  </div>;
}
