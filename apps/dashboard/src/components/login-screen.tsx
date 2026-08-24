"use client";

import { FormEvent, useState } from "react";
import { ArrowUpRight, Shield } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function formatAuthError(reason: unknown) {
  if (reason instanceof Error && (reason.name === "AbortError" || reason.name === "TimeoutError")) {
    return "A conexão demorou muito para responder. Tente novamente.";
  }
  const message = reason instanceof Error ? reason.message : typeof reason === "object" && reason !== null && "message" in reason ? String(reason.message) : "Não foi possível autenticar";
  if (message.includes("over_email_send_rate_limit")) return "O limite de envio de e-mails do Supabase foi atingido. Aguarde antes de tentar novamente ou desative a confirmação de e-mail no projeto de desenvolvimento.";
  return message;
}

export function LoginScreen({ error, onError, defaultEmail, defaultSignUp }: { error: string; onError: (value: string) => void; defaultEmail?: string; defaultSignUp?: boolean }) {
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signUp, setSignUp] = useState(defaultSignUp ?? false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const result = signUp ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signUp) onError("Verifique seu e-mail para confirmar o acesso.");
    } catch (reason) {
      onError(formatAuthError(reason));
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-shell"><div className="auth-grid">
    <div className="auth-intro">
      <div className="brand"><span className="brand-mark"><Shield size={17} /></span><span>DurtOne</span></div>
      <div className="auth-copy"><p className="eyebrow">SECURITY OPERATIONS</p><h1>Clareza quando a superfície muda.</h1><p>Monitore tráfego, bloqueios e APIs que escapam da documentação em um só lugar.</p></div>
      <div className="auth-foot"><span className="pulse" /> DurtOne operacional</div>
    </div>
    <form className="auth-form" onSubmit={submit}>
      <div><p className="eyebrow">DURTONE</p><h2>{signUp ? "Criar acesso" : "Entrar no workspace"}</h2><p className="muted">Use suas credenciais Supabase para continuar.</p></div>
      <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
      <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={signUp ? "new-password" : "current-password"} /></label>
      {error && <div className="notice error">{error}</div>}
      <button className="primary-button" disabled={busy}>{busy ? "Aguarde..." : signUp ? "Criar conta" : "Acessar dashboard"}<ArrowUpRight size={16} /></button>
      <button type="button" className="text-button" onClick={() => { setSignUp(!signUp); onError(""); }}>{signUp ? "Já tenho uma conta" : "Criar uma conta"}</button>
    </form>
  </div></div>;
}
