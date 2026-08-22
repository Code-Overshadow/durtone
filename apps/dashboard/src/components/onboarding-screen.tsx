"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, ArrowUpRight, Shield } from "lucide-react";
import { apiPost } from "@/lib/api/client";

export function OnboardingScreen({ onCreated, onCancel }: { onCreated: () => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/v1/tenants", { name: name.trim() });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o workspace");
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-shell"><div className="auth-grid">
    <div className="auth-intro">
      <div className="brand"><span className="brand-mark"><Shield size={17} /></span><span>DurtOne</span></div>
      <div className="auth-copy"><p className="eyebrow">SECURITY OPERATIONS</p><h1>Crie seu primeiro workspace.</h1><p>Um workspace é onde você configura o DurtWall, DurtGuardian e DurtScope para a sua empresa. Você pode criar mais de um e convidar seu time depois.</p></div>
      <div className="auth-foot"><span className="pulse" /> DurtOne operacional</div>
    </div>
    <form className="auth-form" onSubmit={submit}>
      <div><p className="eyebrow">NOVO WORKSPACE</p><h2>Nome da empresa</h2><p className="muted">Você vai poder convidar outras pessoas depois em Configurações → Usuários.</p></div>
      <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Corp" required minLength={2} maxLength={160} autoFocus /></label>
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      <button className="primary-button" disabled={busy || !name.trim()}>{busy ? "Criando..." : "Criar workspace"}<ArrowUpRight size={16} /></button>
      {onCancel && <button type="button" className="text-button" onClick={onCancel}>Cancelar</button>}
    </form>
  </div></div>;
}
