"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Shield } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api/client";
import { useSupabaseSession } from "@/hooks/use-supabase-session";
import { LoginScreen } from "@/components/login-screen";

type InvitationPreview = { tenantName: string; email: string; role: string; expired: boolean; accepted: boolean };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Membro" };

export default function AcceptInvitePage() {
  return <Suspense fallback={<InviteShell><div className="loader-line" /></InviteShell>}>
    <AcceptInviteContent />
  </Suspense>;
}

function AcceptInviteContent() {
  const router = useRouter();
  const { session, checkingSession } = useSupabaseSession();
  const token = useSearchParams().get("token");
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const acceptedOnceRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    apiGet<InvitationPreview>(`/api/v1/invitations/${token}`)
      .then(setInvitation)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Convite não encontrado"));
  }, [token]);

  useEffect(() => {
    if (!token || !session || !invitation || invitation.accepted || invitation.expired || acceptedOnceRef.current) return;
    acceptedOnceRef.current = true;
    setAccepting(true);
    apiPost(`/api/v1/invitations/${token}/accept`)
      .then(() => router.replace("/"))
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Não foi possível aceitar o convite");
        setAccepting(false);
      });
  }, [token, session, invitation, router]);

  if (!token) return <InviteShell><p className="notice error"><AlertTriangle size={16} />Link de convite inválido.</p></InviteShell>;
  if (error) return <InviteShell><p className="notice error"><AlertTriangle size={16} />{error}</p></InviteShell>;
  if (!invitation || checkingSession) return <InviteShell><div className="loader-line" /></InviteShell>;
  if (invitation.accepted) return <InviteShell><p className="notice error"><AlertTriangle size={16} />Este convite já foi aceito. Faça login normalmente.</p></InviteShell>;
  if (invitation.expired) return <InviteShell><p className="notice error"><AlertTriangle size={16} />Este convite expirou. Peça um novo.</p></InviteShell>;

  if (!session) {
    return <LoginScreen
      error=""
      onError={() => {}}
      defaultEmail={invitation.email}
      defaultSignUp
    />;
  }

  return <InviteShell>
    <p className="muted">{accepting ? "Aceitando convite..." : `Você foi convidado para ${invitation.tenantName} como ${ROLE_LABEL[invitation.role] ?? invitation.role}.`}</p>
    <div className="loader-line" />
  </InviteShell>;
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell"><div className="auth-grid">
    <div className="auth-intro">
      <div className="brand"><span className="brand-mark"><Shield size={17} /></span><span>DurtOne</span></div>
      <div className="auth-copy"><p className="eyebrow">CONVITE</p><h1>Você foi convidado.</h1></div>
    </div>
    <div className="auth-form">{children}</div>
  </div></div>;
}
