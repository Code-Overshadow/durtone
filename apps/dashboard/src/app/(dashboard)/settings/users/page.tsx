"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, Check, Copy, Mail, Send, Trash2, User, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useRefreshable } from "@/hooks/use-refreshable";
import { EmptyState, SectionHeading } from "@/components/dashboard-ui";

type Member = { id: string; email: string; role: string; createdAt: string };
type Invitation = { id: string; email: string; role: string; createdAt: string; expiresAt: string; acceptedAt: string | null };
type Role = "owner" | "admin" | "member";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Membro" };

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return <span className="copy-chip">{text}<button type="button" onClick={copy} aria-label="Copiar token">{copied ? <Check size={13} /> : <Copy size={13} />}</button></span>;
}

export default function UsersSettingsPage() {
  const membersResource = usePollingResource(() => apiGet<{ users: Member[] }>("/api/v1/tenant/users"));
  const invitationsResource = usePollingResource(() => apiGet<{ invitations: Invitation[] }>("/api/v1/tenant/invitations"));
  useRefreshable(() => { void membersResource.refresh(); void invitationsResource.refresh(); });

  const members = membersResource.data?.users ?? [];
  const invitations = invitationsResource.data?.invitations ?? [];

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [memberError, setMemberError] = useState("");
  const [lastInvite, setLastInvite] = useState<{ email: string; link: string } | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await apiPost<{ token: string; email: string }>("/api/v1/tenant/invitations", { email: email.trim().toLowerCase(), role });
      setLastInvite({ email: created.email, link: `${window.location.origin}/accept-invite?token=${created.token}` });
      setEmail("");
      void invitationsResource.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o convite");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: Member, nextRole: Role) {
    setMemberError("");
    try {
      await apiPut(`/api/v1/tenant/users/${member.id}`, { role: nextRole });
      void membersResource.refresh();
    } catch (reason) {
      setMemberError(reason instanceof Error ? reason.message : "Não foi possível trocar o papel");
    }
  }

  async function removeMember(id: string) {
    setMemberError("");
    try {
      await apiDelete(`/api/v1/tenant/users/${id}`);
      void membersResource.refresh();
    } catch (reason) {
      setMemberError(reason instanceof Error ? reason.message : "Não foi possível remover o membro");
    }
  }

  async function revokeInvitation(id: string) {
    await apiDelete(`/api/v1/tenant/invitations/${id}`);
    void invitationsResource.refresh();
  }

  return <div className="content settings-content">
    <SectionHeading kicker="WORKSPACE" title="Usuários" description="Membros do tenant e convites pendentes." />
    <form className="inline-form" onSubmit={invite}>
      <div className="form-grid">
        <label>E-mail do convidado<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Papel<select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="member">Membro</option><option value="admin">Admin</option><option value="owner">Owner</option>
        </select></label>
      </div>
      {error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}
      {lastInvite && <div className="notice">
        <Mail size={16} /> Convite para {lastInvite.email} criado. Como ainda não há SMTP configurado, compartilhe este link manualmente: <CopyChip text={lastInvite.link} />
        <button type="button" className="icon-button" onClick={() => setLastInvite(null)} aria-label="Fechar"><X size={14} /></button>
      </div>}
      <div className="form-actions"><span className="muted">O convidado abre o link pra criar a conta (ou entrar, se já tiver uma) e aceitar.</span><button className="primary-button" type="submit" disabled={busy}><Send size={16} /> {busy ? "Enviando..." : "Convidar"}</button></div>
    </form>

    <SectionHeading kicker="MEMBROS" title="Time" description="Remover um membro tira o acesso dele a este workspace - a conta continua existindo e ele mantém acesso a outros workspaces onde é membro." count={`${members.length} membros`} />
    {memberError && <div className="notice error"><AlertTriangle size={16} />{memberError}</div>}
    <div className="resource-list">
      {members.length ? members.map((member) => <div className="resource-card" key={member.id}>
        <div><strong><User size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />{member.email}</strong><small>desde {new Date(member.createdAt).toLocaleDateString("pt-BR")}</small></div>
        <select value={member.role} onChange={(event) => void changeRole(member, event.target.value as Role)}>
          <option value="member">Membro</option><option value="admin">Admin</option><option value="owner">Owner</option>
        </select>
        <div className="resource-actions"><button className="danger-button" onClick={() => void removeMember(member.id)}><Trash2 size={13} /> Remover deste workspace</button></div>
      </div>) : <EmptyState label="Nenhum membro além de você" />}
    </div>

    <SectionHeading kicker="CONVITES" title="Pendentes" count={`${invitations.length} pendentes`} />
    <div className="resource-list">
      {invitations.length ? invitations.map((invitation) => <div className="resource-card" key={invitation.id}>
        <div><strong><Mail size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />{invitation.email}</strong><small>{ROLE_LABEL[invitation.role] ?? invitation.role} · expira em {new Date(invitation.expiresAt).toLocaleDateString("pt-BR")}</small></div>
        <span className="status-tag">{invitation.acceptedAt ? "aceito" : "aguardando"}</span>
        <div className="resource-actions"><button className="danger-button" onClick={() => void revokeInvitation(invitation.id)}><Trash2 size={13} /> Revogar</button></div>
      </div>) : <EmptyState label="Nenhum convite pendente" />}
    </div>
  </div>;
}
