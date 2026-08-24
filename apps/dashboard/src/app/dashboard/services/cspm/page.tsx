"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Cloud, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { useDashboardShell } from "@/components/dashboard-shell-context";
import { EmptyState, HelpCallout, SectionHeading, ServiceBackLink, StatusTag } from "@/components/dashboard-ui";

type CloudAccount = { id: string; provider: string; accountId: string; displayName: string; regions: string[]; enabled: boolean; status: "healthy" | "error" | "unknown"; lastCheckedAt: string | null; lastError: string | null; lastScanAt: string | null };
type Provider = "aws" | "azure" | "gcp";

const emptyForm = { provider: "aws" as Provider, accountId: "", displayName: "", regions: "", accessKeyId: "", secretAccessKey: "", clientId: "", clientSecret: "", tenantId: "", serviceAccountJson: "" };

function buildCredential(form: typeof emptyForm) {
  if (form.provider === "aws") return { accessKeyId: form.accessKeyId, secretAccessKey: form.secretAccessKey };
  if (form.provider === "azure") return { clientId: form.clientId, clientSecret: form.clientSecret, tenantId: form.tenantId };
  return { serviceAccountJson: form.serviceAccountJson };
}

function healthTagStatus(account: CloudAccount): "healthy" | "unhealthy" | "unknown" {
  if (account.status === "healthy") return "healthy";
  if (account.status === "error") return "unhealthy";
  return "unknown";
}

export default function CspmSettingsPage() {
  const { refreshIntervals } = useDashboardShell();
  const accountsResource = usePollingResource(() => apiGet<{ accounts: CloudAccount[] }>("/api/v1/cloud-accounts"), { intervalMs: refreshIntervals.cspm });
  useRefreshable(() => void accountsResource.refresh());
  const accounts = accountsResource.data?.accounts ?? [];

  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);

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

  async function testConnection(id: string) {
    setTestingId(id);
    try {
      await apiPost(`/api/v1/cloud-accounts/${id}/test`, {});
    } catch {
      // status/lastError já foram persistidos pela API mesmo em caso de falha - o refresh mostra o resultado
    } finally {
      setTestingId(null);
      void accountsResource.refresh();
    }
  }

  return <div className="content settings-content">
    <ServiceBackLink />
    <SectionHeading kicker="DURTGUARDIAN" title="Contas cloud" description="Credenciais que o DurtGuardian usa para varrer a postura CSPM de cada conta." />
    <HelpCallout title="O que o DurtGuardian precisa">
      Uma credencial de <strong>leitura</strong> (nunca escrita) na conta cloud — para AWS, um usuário/role IAM com acesso somente-leitura basta. O DurtGuardian varre a cada poucos minutos, compara com a última varredura e aponta drift de configuração automaticamente, sem agendar nada do seu lado.
    </HelpCallout>
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
        {form.provider === "gcp" && <label>JSON da service account<textarea value={form.serviceAccountJson} onChange={(event) => setForm({ ...form, serviceAccountJson: event.target.value })} placeholder='{"type": "service_account", "client_email": "...", "private_key": "...", ...}' rows={4} required /></label>}
      </div>
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <div className="form-actions"><span className="muted">Credenciais são cifradas antes de persistir e nunca retornam nas respostas.</span><button className="primary-button" type="submit" disabled={busy}><Plus size={16} /> {busy ? "Cadastrando..." : "Adicionar conta"}</button></div>
    </form>
    <div className="resource-list">
      {accounts.length ? accounts.map((account) => <div className="resource-card" key={account.id}>
        <div><strong><Cloud size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />{account.displayName}</strong><small>{account.provider} · {account.accountId} · {account.regions.join(", ") || "sem região definida"}</small></div>
        <StatusTag status={healthTagStatus(account)} title={account.lastError ?? undefined} />
        <span className={account.enabled ? "status-tag enabled" : "status-tag disabled"}>{account.enabled ? "Ativa" : "Pausada"}</span>
        <div className="resource-actions">
          <button className="ghost-button" onClick={() => void testConnection(account.id)} disabled={testingId === account.id}>{testingId === account.id ? "Testando..." : "Testar conexão"}</button>
          <button className="ghost-button" onClick={() => void toggle(account)}>{account.enabled ? "Pausar" : "Reativar"}</button>
          <button className="danger-button" onClick={() => void remove(account.id)}><Trash2 size={13} /> Remover</button>
        </div>
      </div>) : <EmptyState label="Nenhuma conta cloud cadastrada ainda" />}
    </div>
  </div>;
}
