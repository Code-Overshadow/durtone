"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, CheckCircle2, LogOut, Menu, RefreshCw, Shield, X } from "lucide-react";
import { apiGet } from "@/lib/api/client";
import { usePollingResource } from "@/hooks/use-polling-resource";
import { useSupabaseSession } from "@/hooks/use-supabase-session";
import { useIdleLogout } from "@/hooks/use-idle-logout";
import { requestRefresh } from "@/lib/refresh-bus";
import { getActiveTenantId, setActiveCountry, setActiveTenantId } from "@/lib/active-tenant";
import { LoginScreen } from "@/components/login-screen";
import { OnboardingScreen } from "@/components/onboarding-screen";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { NAV_ITEMS } from "@/components/nav-items";
import { DashboardShellContext, describeDomainStatus, emptyStats, mergeRefreshIntervals, type Domain, type Membership, type Stats } from "@/components/dashboard-shell-context";

type TenantSettings = { settings?: { refreshIntervals?: Record<string, unknown> } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, checkingSession, signOut } = useSupabaseSession();
  useIdleLogout(() => void signOut());
  const [authError, setAuthError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const pathname = usePathname();

  const enabled = Boolean(session);
  const membershipsResource = usePollingResource(() => apiGet<{ memberships: Membership[] }>("/api/v1/tenants"), { enabled, intervalMs: 60_000 });
  const tenantSettingsResource = usePollingResource(() => apiGet<TenantSettings>("/api/v1/tenant"), { enabled, intervalMs: 60_000 });
  const refreshIntervals = mergeRefreshIntervals(tenantSettingsResource.data?.settings?.refreshIntervals);
  const statsResource = usePollingResource(() => apiGet<Stats>("/api/v1/stats"), { enabled, intervalMs: refreshIntervals.stats });
  const domainsResource = usePollingResource(() => apiGet<{ domains: Domain[] }>("/api/v1/domains"), { enabled, intervalMs: refreshIntervals.domains });

  if (checkingSession) return <div className="auth-shell"><div className="loader-line" /></div>;
  if (!session) return <LoginScreen error={authError} onError={setAuthError} />;

  if (!membershipsResource.data) {
    return <div className="auth-shell"><div className="loader-line" />
      {membershipsResource.error && <div className="notice error"><AlertTriangle size={16} />{membershipsResource.error} <button className="text-button" onClick={() => void membershipsResource.refresh()}>Tentar novamente</button></div>}
    </div>;
  }
  const memberships = membershipsResource.data.memberships;
  if (memberships.length === 0) {
    return <OnboardingScreen onCreated={() => void membershipsResource.refresh()} />;
  }
  if (creatingTenant) {
    return <OnboardingScreen onCreated={() => { setCreatingTenant(false); void membershipsResource.refresh(); }} onCancel={() => setCreatingTenant(false)} />;
  }

  const userId = session.user.id;
  const storedTenantId = getActiveTenantId(userId);
  const activeTenantId = memberships.some((membership) => membership.tenantId === storedTenantId) ? storedTenantId! : memberships[0]!.tenantId;
  if (activeTenantId !== storedTenantId) setActiveTenantId(userId, activeTenantId);
  setActiveCountry(memberships.find((membership) => membership.tenantId === activeTenantId)?.country ?? "BR");

  function switchTenant(tenantId: string) {
    setActiveTenantId(userId, tenantId);
    requestRefresh();
  }

  const stats = statsResource.data ?? emptyStats;
  const domains = domainsResource.data?.domains ?? [];
  const domainStatus = describeDomainStatus(domains);
  const loading = statsResource.loading || domainsResource.loading;
  function isNavItemActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/dashboard/services") return pathname.startsWith("/dashboard/services");
    if (href === "/dashboard/account/tenant") return pathname.startsWith("/dashboard/account");
    return pathname === href;
  }

  return <DashboardShellContext.Provider value={{ stats, domains, refreshDomains: () => void domainsResource.refresh(), activeTenantId, memberships, refreshIntervals }}>
    <div className="dashboard-shell">
      <aside className={mobileNav ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand"><span className="brand-mark"><Shield size={17} /></span><span>DurtOne</span><button className="icon-button close-nav" onClick={() => setMobileNav(false)} aria-label="Fechar menu"><X size={17} /></button></div>
        <TenantSwitcher memberships={memberships} activeTenantId={activeTenantId} onSwitch={switchTenant} onCreateNew={() => setCreatingTenant(true)} />
        <nav>{NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isNavItemActive(href);
          return <Link key={href} href={href} className={active ? "nav-item active" : "nav-item"} onClick={() => setMobileNav(false)}><Icon size={17} /><span>{label}</span>{href === "/dashboard/surface" && stats.shadowApis > 0 && <b>{stats.shadowApis}</b>}</Link>;
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
