"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Check, Copy, Globe, RefreshCw, Trash2 } from "lucide-react";
import { apiDelete, apiPost } from "@/lib/api/client";
import { useDashboardShell } from "@/components/dashboard-shell-context";
import { EmptyState, SectionHeading } from "@/components/dashboard-ui";

const EDGE_HOSTNAME = process.env.NEXT_PUBLIC_EDGE_HOSTNAME ?? "edge.durtone.io";

const STATUS_LABEL: Record<string, string> = {
  pending_dns: "Aguardando DNS",
  pending_certificate: "Emitindo certificado",
  active: "Ativo",
  error: "Erro",
};

function statusClass(status: string) {
  if (status === "active") return "status-tag documented";
  if (status === "error") return "status-tag shadow";
  return "status-tag";
}

function CnameChip() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(EDGE_HOSTNAME);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return <span className="copy-chip">{EDGE_HOSTNAME}<button type="button" onClick={copy} aria-label="Copiar hostname">{copied ? <Check size={13} /> : <Copy size={13} />}</button></span>;
}

export default function DomainsSettingsPage() {
  const { domains, refreshDomains } = useDashboardShell();
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recheckingId, setRecheckingId] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/v1/domains", { hostname: hostname.trim().toLowerCase() });
      setHostname("");
      refreshDomains();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível cadastrar o domínio");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await apiDelete(`/api/v1/domains/${id}`);
    refreshDomains();
  }

  async function recheck(id: string) {
    setRecheckingId(id);
    try {
      await apiPost(`/api/v1/domains/${id}/recheck`);
      refreshDomains();
    } finally {
      setRecheckingId(null);
    }
  }

  return <div className="content settings-content">
    <SectionHeading kicker="EDGE PROXY DEPLOYMENT" title="Domínios" description="Aponte um CNAME do seu domínio para o fleet do DurtWall - sem instalar nada." />
    <form className="inline-form" onSubmit={submit}>
      <label>Domínio<input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="app.seudominio.com" required /></label>
      <div>
        <span className="muted">Depois de cadastrar, aponte um registro CNAME desse domínio para</span> <CnameChip />
      </div>
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <div className="form-actions"><span className="muted">Certificado TLS é emitido automaticamente assim que o DNS resolver.</span><button className="primary-button" type="submit" disabled={busy}>{busy ? "Cadastrando..." : "Adicionar domínio"}</button></div>
    </form>
    <div className="resource-list">
      {domains.length ? domains.map((domain) => <div className="resource-card" key={domain.id}>
        <div><strong><Globe size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />{domain.hostname}</strong><small>{domain.status === "error" && domain.errorMessage ? domain.errorMessage : "CNAME para " + EDGE_HOSTNAME}</small></div>
        <span className={statusClass(domain.status)}>{STATUS_LABEL[domain.status] ?? domain.status}</span>
        <div className="resource-actions">
          <button className="ghost-button" onClick={() => void recheck(domain.id)} disabled={recheckingId === domain.id}><RefreshCw size={13} className={recheckingId === domain.id ? "spin" : ""} /> Reverificar</button>
          <button className="danger-button" onClick={() => void remove(domain.id)}><Trash2 size={13} /> Remover</button>
        </div>
      </div>) : <EmptyState label="Nenhum domínio cadastrado ainda" />}
    </div>
  </div>;
}
