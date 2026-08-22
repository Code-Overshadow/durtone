"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Cloud, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { EmptyState, SectionHeading } from "@/components/dashboard-ui";

type CloudAccount = { id: string; provider: string; accountId: string; displayName: string; regions: string[]; enabled: boolean; lastScanAt: string | null };
type Provider = "aws" | "azure" | "gcp";

const emptyForm = { provider: "aws" as Provider, accountId: "", displayName: "", regions: "", accessKeyId: "", secretAccessKey: "", clientId: "", clientSecret: "", tenantId: "", credentialsPath: "" };

function buildCredential(form: typeof emptyForm) {
  if (form.provider === "aws") return { accessKeyId: form.accessKeyId, secretAccessKey: form.secretAccessKey };
  if (form.provider === "azure") return { clientId: form.clientId, clientSecret: form.clientSecret, tenantId: form.tenantId };
  return { credentialsPath: form.credentialsPath };
}

export default function CspmSettingsPage() {
  const accountsResource = usePollingResource(() => apiGet<{ accounts: CloudAccount[] }>("/api/v1/cloud-accounts"));
  useRefreshable(() => void accountsResource.refresh());
  const accounts = accountsResource.data?.accounts ?? [];

  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/v1/cloud-accounts", {
        provider: form.provider,
        accountId: form.accountId.trim(),
        displayName: form.displayName.trim(),
        regions: form.regions.split(",").map((region) => region.trim()).filter(Boolean),
        credential: buildCredential(form),
      });
      setForm(emptyForm);
      void accountsResource.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível cadastrar a conta cloud");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(account: CloudAccount) {
    await apiPut(`/api/v1/cloud-accounts/${account.id}`, { displayName: account.displayName, regions: account.regions, enabled: !account.enabled });
    void accountsResource.refresh();
  }

  async function remove(id: string) {
    await apiDelete(`/api/v1/cloud-accounts/${id}`);
    void accountsResource.refresh();
  }

  return <div className="content settings-content">
    <SectionHeading kicker="DURTGUARDIAN" title="Contas cloud" description="Credenciais que o DurtGuardian usa para varrer a postura CSPM de cada conta." />
    <form className="inline-form" onSubmit={submit}>
      <div className="form-grid">
        <label>Provider<select value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as Provider })}>
          <option value="aws">AWS</option><option value="azure">Azure</option><option value="gcp">GCP</option>
        </select></label>
        <label>Account ID / Subscription / Project<input value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} required /></label>
        <label>Nome de exibição<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /></label>
        <label>Regiões <span className="optional">separadas por vírgula</span><input value={form.regions} onChange={(event) => setForm({ ...form, regions: event.target.value })} placeholder="us-east-1, eu-west-1" /></label>
        {form.provider === "aws" && <>
          <label>Access key ID<input value={form.accessKeyId} onChange={(event) => setForm({ ...form, accessKeyId: event.target.value })} autoComplete="off" required /></label>
          <label>Secret access key<input type="password" value={form.secretAccessKey} onChange={(event) => setForm({ ...form, secretAccessKey: event.target.value })} autoComplete="new-password" required /></label>
        </>}
        {form.provider === "azure" && <>
          <label>Client ID<input value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} autoComplete="off" required /></label>
          <label>Client secret<input type="password" value={form.clientSecret} onChange={(event) => setForm({ ...form, clientSecret: event.target.value })} autoComplete="new-password" required /></label>
          <label>Tenant ID<input value={form.tenantId} onChange={(event) => setForm({ ...form, tenantId: event.target.value })} required /></label>
        </>}
        {form.provider === "gcp" && <label>Caminho do service account JSON<input value={form.credentialsPath} onChange={(event) => setForm({ ...form, credentialsPath: event.target.value })} placeholder="/secrets/gcp-service-account.json" required /></label>}
      </div>
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <div className="form-actions"><span className="muted">Credenciais são cifradas antes de persistir e nunca retornam nas respostas.</span><button className="primary-button" type="submit" disabled={busy}><Plus size={16} /> {busy ? "Cadastrando..." : "Adicionar conta"}</button></div>
    </form>
    <div className="resource-list">
      {accounts.length ? accounts.map((account) => <div className="resource-card" key={account.id}>
        <div><strong><Cloud size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />{account.displayName}</strong><small>{account.provider} · {account.accountId} · {account.regions.join(", ") || "sem região definida"}</small></div>
        <span className={account.enabled ? "status-tag enabled" : "status-tag disabled"}>{account.enabled ? "Ativa" : "Pausada"}</span>
        <div className="resource-actions">
          <button className="ghost-button" onClick={() => void toggle(account)}>{account.enabled ? "Pausar" : "Reativar"}</button>
          <button className="danger-button" onClick={() => void remove(account.id)}><Trash2 size={13} /> Remover</button>
        </div>
      </div>) : <EmptyState label="Nenhuma conta cloud cadastrada ainda" />}
    </div>
  </div>;
}
