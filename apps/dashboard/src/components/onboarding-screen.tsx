"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, ArrowUpRight, Shield } from "lucide-react";
import { apiPost } from "@/lib/api/client";

type DocumentType = "cnpj" | "cpf";

const emptyForm = { name: "", country: "BR", documentType: "cnpj" as DocumentType, documentNumber: "", legalName: "", termsAccepted: false };

export function OnboardingScreen({ onCreated, onCancel }: { onCreated: () => void; onCancel?: () => void }) {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isBrazil = form.country === "BR";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/v1/tenants", {
        name: form.name.trim(),
        country: form.country,
        termsAccepted: form.termsAccepted,
        ...(isBrazil ? {
          documentType: form.documentType,
          documentNumber: form.documentNumber.replace(/\D/g, ""),
          legalName: form.legalName.trim(),
        } : {}),
      });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o workspace");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = form.name.trim().length >= 2 && form.termsAccepted && (!isBrazil || (form.documentNumber.replace(/\D/g, "").length > 0 && form.legalName.trim()));

  return <div className="auth-shell"><div className="auth-grid">
    <div className="auth-intro">
      <div className="brand"><span className="brand-mark"><Shield size={17} /></span><span>DurtOne</span></div>
      <div className="auth-copy"><p className="eyebrow">SECURITY OPERATIONS</p><h1>Crie seu primeiro workspace.</h1><p>Um workspace é onde você configura o DurtWall, DurtGuardian e DurtScope para a sua empresa. Você pode criar mais de um e convidar seu time depois.</p></div>
      <div className="auth-foot"><span className="pulse" /> DurtOne operacional</div>
    </div>
    <form className="auth-form" onSubmit={submit}>
      <div><p className="eyebrow">NOVO WORKSPACE</p><h2>Dados do workspace</h2><p className="muted">Coletamos o mínimo necessário pra identificar sua empresa (LGPD). Você pode convidar outras pessoas depois em Configurações → Usuários.</p></div>
      <label>Nome<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Acme Corp" required minLength={2} maxLength={160} autoFocus /></label>
      <label>País<select value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })}>
        <option value="BR">Brasil</option>
        <option value="US">Estados Unidos</option>
        <option value="PT">Portugal</option>
        <option value="OTHER">Outro</option>
      </select></label>
      {isBrazil && <>
        <label>Tipo de conta<select value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value as DocumentType })}>
          <option value="cnpj">Empresa (CNPJ)</option>
          <option value="cpf">Pessoa física (CPF)</option>
        </select></label>
        <label>{form.documentType === "cnpj" ? "CNPJ" : "CPF"}<input value={form.documentNumber} onChange={(event) => setForm({ ...form, documentNumber: event.target.value })} placeholder={form.documentType === "cnpj" ? "00.000.000/0000-00" : "000.000.000-00"} required inputMode="numeric" /></label>
        <label>{form.documentType === "cnpj" ? "Razão social" : "Nome completo"}<input value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} required /></label>
      </>}
      <label className="checkbox-label">
        <input type="checkbox" checked={form.termsAccepted} onChange={(event) => setForm({ ...form, termsAccepted: event.target.checked })} />
        <span>Li e aceito os <a href="/termos" target="_blank" rel="noopener noreferrer">Termos de Uso</a> e a <a href="/privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>.</span>
      </label>
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <button className="primary-button" disabled={busy || !canSubmit}>{busy ? "Criando..." : "Criar workspace"}<ArrowUpRight size={16} /></button>
      {onCancel && <button type="button" className="text-button" onClick={onCancel}>Cancelar</button>}
    </form>
  </div></div>;
}
