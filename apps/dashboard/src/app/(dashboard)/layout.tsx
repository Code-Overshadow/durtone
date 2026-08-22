"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronRight, LogOut, Menu, RefreshCw, Shield, X } from "lucide-react";
import { apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useSupabaseSession } from "@/hooks/use-supabase-session";
import { requestRefresh } from "@/lib/refresh-bus";
import { LoginScreen } from "@/components/login-screen";
import { NAV_ITEMS } from "@/components/nav-items";
import { DashboardShellContext, describeDomainStatus, emptyStats, type Domain, type Stats } from "@/components/dashboard-shell-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, checkingSession, signOut } = useSupabaseSession();
  const [authError, setAuthError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const pathname = usePathname();

  const enabled = Boolean(session);
  const statsResource = usePollingResource(() => apiGet<Stats>("/api/v1/stats"), { enabled });
  const domainsResource = usePollingResource(() => apiGet<{ domains: Domain[] }>("/api/v1/domains"), { enabled });

  if (checkingSession) return <div className="auth-shell"><div className="loader-line" /></div>;
  if (!session) return <LoginScreen error={authError} onError={setAuthError} />;

  const stats = statsResource.data ?? emptyStats;
  const domains = domainsResource.data?.domains ?? [];
  const domainStatus = describeDomainStatus(domains);
  const loading = statsResource.loading || domainsResource.loading;
  const activeSettings = pathname.startsWith("/settings");

  return <DashboardShellContext.Provider value={{ stats, domains, refreshDomains: () => void domainsResource.refresh() }}>
    <div className="dashboard-shell">
      <aside className={mobileNav ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand"><span className="brand-mark"><Shield size={17} /></span><span>DurtOne</span><button className="icon-button close-nav" onClick={() => setMobileNav(false)} aria-label="Fechar menu"><X size={17} /></button></div>
        <div className="tenant-switch"><span className="tenant-dot" /><span>Workspace principal</span><ChevronRight size={14} /></div>
        <nav>{NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/settings/waf" ? activeSettings : pathname === href;
          return <Link key={href} href={href} className={active ? "nav-item active" : "nav-item"} onClick={() => setMobileNav(false)}><Icon size={17} /><span>{label}</span>{href === "/surface" && stats.shadowApis > 0 && <b>{stats.shadowApis}</b>}</Link>;
        })}</nav>
        <div className="sidebar-bottom">
          <div className={domainStatus.online ? "agent-status" : "agent-status offline"}><span className={domainStatus.online ? "pulse" : "pulse offline"} /><div><strong>DurtWall</strong><small>{domainStatus.label}</small></div>{domainStatus.online ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</div>
          <button className="nav-item" onClick={() => void signOut()}><LogOut size={17} /><span>Sair</span></button>
        </div>
      </aside>
      {mobileNav && <button className="nav-overlay" onClick={() => setMobileNav(false)} aria-label="Fechar navegação" />}
      <main className="main-area">
        <header className="topbar topbar-slim">
          <button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="Abrir menu"><Menu size={20} /></button>
          <div className="top-actions"><span className="live-indicator"><span className="pulse" /> ao vivo</span><button className="icon-button" onClick={requestRefresh} disabled={loading} aria-label="Atualizar dados"><RefreshCw size={17} className={loading ? "spin" : ""} /></button></div>
        </header>
        {children}
      </main>
    </div>
  </DashboardShellContext.Provider>;
}
