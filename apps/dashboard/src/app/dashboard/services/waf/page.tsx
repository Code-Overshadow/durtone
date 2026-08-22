"use client";

import { FormEvent } from "react";
import { AlertTriangle, Save } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api/client";
import { useEditableResource } from "@/hooks/use-editable-resource";
import { EmptyState, HelpCallout, SectionHeading, ServiceBackLink } from "@/components/dashboard-ui";

type Config = { upstream: string; mode: "block" | "monitor"; alertWebhookUrl?: string };

export default function WafSettingsPage() {
  const resource = useEditableResource<Config>({
    fetcher: () => apiGet<Config>("/api/v1/config"),
    saver: (value) => apiPut<Config>("/api/v1/config", value),
  });
  const { value: config, dirty, status, error, update, discard, save } = resource;

  if (!config) return <div className="content settings-content"><EmptyState label="Carregando configuração..." /></div>;

  function submit(event: FormEvent) {
    event.preventDefault();
    void save();
  }

  return <div className="content settings-content">
    <ServiceBackLink />
    <SectionHeading kicker="DURTWALL" title="Configuração do WAF" description="Upstream, modo de operação e webhook de alertas do proxy gerenciado." />
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
  </div>;
}
