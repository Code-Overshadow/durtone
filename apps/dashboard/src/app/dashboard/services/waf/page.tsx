"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Check, Copy, Globe, RefreshCw, Save, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import { useEditableResource } from "@/hooks/use-editable-resource";
import { useDashboardShell } from "@/components/dashboard-shell-context";
import { EmptyState, HelpCallout, SectionHeading, ServiceBackLink } from "@/components/dashboard-ui";

type Config = { upstream: string; mode: "block" | "monitor"; alertWebhookUrl?: string };
type Tab = "config" | "domains";

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

function WafConfigTab() {
  const resource = useEditableResource<Config>({
    fetcher: () => apiGet<Config>("/api/v1/config"),
    saver: (value) => apiPut<Config>("/api/v1/config", value),
  });
  const { value: config, dirty, status, error, update, discard, save } = resource;

  if (!config) return <EmptyState label="Carregando configuração..." />;

  function submit(event: FormEvent) {
    event.preventDefault();
    void save();
  }

  return <>
    <HelpCallout title="Como funciona">
      Aponte o <strong>upstream</strong> para o endereço real da sua aplicação (ex.: <code>https://app-interna:3000</code>). Em <strong>Bloquear ameaças</strong> o DurtWall rejeita o tráfego malicioso; em <strong>Somente monitorar</strong> ele só registra, sem bloquear — use esse modo pra validar antes de ativar o bloqueio de verdade.
    </HelpCallout>
    <form className="panel settings-panel" onSubmit={submit}>
      <label>Upstream da aplicação<input type="url" value={config.upstream} onChange={(event) => update({ upstream: event.target.value })} required /></label>
      <div><span className="field-label">Modo de operação</span><div className="segmented">{(["block", "monitor"] as const).map((mode) => <button type="button" key={mode} className={config.mode === mode ? "selected" : ""} onClick={() => update({ mode })}>{mode === "block" ? "Bloquear ameaças" : "Somente monitorar"}</button>)}</div></div>
      <label>Webhook de alertas <span className="optional">opcional</span><input type="url" value={config.alertWebhookUrl ?? ""} onChange={(event) => update({ alertWebhookUrl: event.target.value })} placeholder="https://hooks.slack.com/..." /></label>
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <div className="form-actions">
        <span className="muted">{dirty ? "Alterações não salvas." : "Configuração aplicada ao fleet do DurtWall na próxima sincronização."}</span>
        {dirty && <button className="text-button" type="button" onClick={discard}>Descartar</button>}
        <button className="primary-button" type="submit" disabled={status === "saving"}><Save size={16} /> {status === "saving" ? "Salvando..." : "Salvar configuração"}</button>
      </div>
    </form>
  </>;
}

function DomainsTab() {
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

  return <>
    <HelpCallout title="Como apontar seu domínio">
      Cadastre o domínio abaixo, depois crie um registro <strong>CNAME</strong> na sua zona de DNS apontando pra <code>{EDGE_HOSTNAME}</code>. Assim que o DNS propagar, o status muda de &ldquo;Aguardando DNS&rdquo; pra &ldquo;Emitindo certificado&rdquo; e depois &ldquo;Ativo&rdquo; — automaticamente, sem nenhuma ação extra sua.
    </HelpCallout>
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
  </>;
}

export default function WafServicePage() {
  const [tab, setTab] = useState<Tab>("config");

  return <div className="content settings-content">
    <ServiceBackLink />
    <SectionHeading kicker="DURTWALL" title="WAF & Domínios" description="Configuração do proxy gerenciado e os domínios que ele protege." />
    <div className="segmented" style={{ marginBottom: 24 }}>
      <button type="button" className={tab === "config" ? "selected" : ""} onClick={() => setTab("config")}>Configuração</button>
      <button type="button" className={tab === "domains" ? "selected" : ""} onClick={() => setTab("domains")}>Domínios</button>
    </div>
    {tab === "config" ? <WafConfigTab /> : <DomainsTab />}
  </div>;
}
