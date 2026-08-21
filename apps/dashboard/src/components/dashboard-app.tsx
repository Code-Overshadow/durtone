"use client";

import { FormEvent, useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight, FileSearch, Gauge, LogOut, Menu, RefreshCw, Save, Shield, Terminal, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type View = "overview" | "logs" | "surface" | "settings" | "cspm" | "security";
type Stats = { totalRequests: number; blockedRequests: number; discoveredEndpoints: number; shadowApis: number };
type Endpoint = { method: string; path: string; count: number; documented: boolean; shadow: boolean };
type RequestLog = { id: string; method: string; path: string; status: number; remoteIp: string; blocked: boolean; timestamp: string };
type CspmDrift = { kind: "changed" | "new" | "missing"; resource: string; before?: string; after?: string };
type CspmSummary = { provider: string; accountId: string; postureScore: number; totalChecks: number; passChecks: number; failChecks: number; criticalFindings: number; driftCount: number; lastScanAt: string; drifts: CspmDrift[] };
type SecurityScore = { score: number; components: { waf: number; cspm: number; itdr: number }; weights: { waf: number; cspm: number; itdr: number } };
type Config = { upstream: string; mode: "block" | "monitor"; alertWebhookUrl?: string; identityProvider: "none" | "keycloak" | "okta" | "aws" | "google"; identityBaseUrl?: string; identityRealm?: string; identityTenant?: string; identityRegion?: string; identityClientId?: string; identityClientSecret?: string; identityAccessToken?: string };
type AgentEnrollment = { id: string; name: string; revoked: boolean; lastUsedAt: string | null; createdAt: string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const emptyStats: Stats = { totalRequests: 0, blockedRequests: 0, discoveredEndpoints: 0, shadowApis: 0 };
const AGENT_ONLINE_THRESHOLD_MS = 60_000;

function describeAgentStatus(agents: AgentEnrollment[]) {
  const active = agents.filter((agent) => !agent.revoked && agent.lastUsedAt);
  if (!active.length) return { online: false, label: "Nenhum agente conectado" };
  const mostRecent = active.reduce((latest, agent) => (new Date(agent.lastUsedAt!).getTime() > new Date(latest.lastUsedAt!).getTime() ? agent : latest));
  const ageMs = Date.now() - new Date(mostRecent.lastUsedAt!).getTime();
  if (ageMs < AGENT_ONLINE_THRESHOLD_MS) return { online: true, label: `${mostRecent.name} conectado` };
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  return { online: false, label: `${mostRecent.name} sem sinal há ${minutes}min` };
}

export function DashboardApp() {
  const [session, setSession] = useState<unknown>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [authError, setAuthError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [stats, setStats] = useState(emptyStats);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [cspm, setCspm] = useState<CspmSummary | null>(null);
  const [agents, setAgents] = useState<AgentEnrollment[]>([]);
  const [securityScore, setSecurityScore] = useState<SecurityScore | null>(null);
  const [config, setConfig] = useState<Config>({ upstream: "http://localhost:3001", mode: "block", alertWebhookUrl: "", identityProvider: "none", identityBaseUrl: "", identityRealm: "", identityTenant: "", identityRegion: "us-east-1", identityClientId: "", identityClientSecret: "", identityAccessToken: "" });
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  useEffect(() => {
    let active = true;
    try {
      const supabase = createSupabaseBrowserClient();
      supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setCheckingSession(false); } });
      const subscription = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
      return () => { active = false; subscription.data.subscription.unsubscribe(); };
    } catch { window.setTimeout(() => setCheckingSession(false), 0); }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshData();
    const timer = window.setInterval(() => void refreshData(), 15000);
    return () => window.clearInterval(timer);
  }, [session]);

  async function refreshData() {
    setLoading(true); setApiError("");
    try {
      const sessionResult = await createSupabaseBrowserClient().auth.getSession();
      const headers: Record<string, string> = {};
      if (sessionResult.data.session?.access_token) headers.Authorization = `Bearer ${sessionResult.data.session.access_token}`;
      const responses = await Promise.all([
        fetch(`${apiUrl}/api/v1/stats`, { headers }),
        fetch(`${apiUrl}/api/v1/logs`, { headers }),
        fetch(`${apiUrl}/api/v1/endpoints`, { headers }),
        fetch(`${apiUrl}/api/v1/config`, { headers }),
        fetch(`${apiUrl}/api/v1/cspm/summary`, { headers }),
        fetch(`${apiUrl}/api/v1/security/score`, { headers }),
        fetch(`${apiUrl}/api/v1/agents`, { headers }),
      ]);
      if (responses.some((response) => !response.ok)) throw new Error("Control Plane indisponível");
      const [nextStats, nextLogs, nextEndpoints, nextConfig, nextCspm, nextSecurityScore, nextAgents] = await Promise.all(responses.map((response) => response.json()));
      setStats(nextStats); setLogs(nextLogs.logs ?? []); setEndpoints(nextEndpoints.endpoints ?? []); setConfig(nextConfig); setCspm(nextCspm); setSecurityScore(nextSecurityScore); setAgents(nextAgents.agents ?? []);
    } catch (error) { setApiError(error instanceof Error ? error.message : "Falha ao carregar dados"); }
    finally { setLoading(false); }
  }

  if (checkingSession) return <div className="auth-shell"><div className="loader-line" /></div>;
  if (!session) return <LoginScreen error={authError} onError={setAuthError} />;

  const agentStatus = describeAgentStatus(agents);
  const navItems: { id: View; label: string; icon: typeof Gauge }[] = [
    { id: "overview", label: "Visão geral", icon: Gauge }, { id: "logs", label: "Eventos", icon: Activity },
    { id: "surface", label: "Superfície API", icon: FileSearch }, { id: "cspm", label: "CSPM", icon: Shield },
    { id: "security", label: "Security Score", icon: Gauge },
    { id: "settings", label: "Configuração", icon: Shield },
  ];
  async function signOut() { await createSupabaseBrowserClient().auth.signOut(); setSession(null); }
  async function saveConfig(event: FormEvent) { event.preventDefault(); try { const sessionResult = await createSupabaseBrowserClient().auth.getSession(); const authorization: Record<string, string> = {}; if (sessionResult.data.session?.access_token) authorization.Authorization = `Bearer ${sessionResult.data.session.access_token}`; const response = await fetch(`${apiUrl}/api/v1/config`, { method: "PUT", headers: { "Content-Type": "application/json", ...authorization }, body: JSON.stringify(config) }); if (!response.ok) throw new Error("Configuração inválida"); setConfig(await response.json()); } catch (error) { setApiError(error instanceof Error ? error.message : "Falha ao salvar"); } }
  async function downloadReport() { try { const sessionResult = await createSupabaseBrowserClient().auth.getSession(); const authorization: Record<string, string> = {}; if (sessionResult.data.session?.access_token) authorization.Authorization = `Bearer ${sessionResult.data.session.access_token}`; const response = await fetch(`${apiUrl}/api/v1/security/report.pdf`, { headers: authorization }); if (!response.ok) throw new Error("Não foi possível gerar o relatório"); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = "durtone-security-report.pdf"; link.click(); URL.revokeObjectURL(url); } catch (error) { setApiError(error instanceof Error ? error.message : "Falha ao gerar relatório"); } }

  return <div className="dashboard-shell">
    <aside className={mobileNav ? "sidebar sidebar-open" : "sidebar"}>
      <div className="brand"><span className="brand-mark"><Shield size={17} /></span><span>DurtOne</span><button className="icon-button close-nav" onClick={() => setMobileNav(false)} aria-label="Fechar menu"><X size={17} /></button></div>
      <div className="tenant-switch"><span className="tenant-dot" /><span>Workspace principal</span><ChevronRight size={14} /></div>
      <nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => { setView(id); setMobileNav(false); }}><Icon size={17} /><span>{label}</span>{id === "surface" && stats.shadowApis > 0 && <b>{stats.shadowApis}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className={agentStatus.online ? "agent-status" : "agent-status offline"}><span className={agentStatus.online ? "pulse" : "pulse offline"} /><div><strong>DurtWall</strong><small>{agentStatus.label}</small></div>{agentStatus.online ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</div><button className="nav-item" onClick={() => void signOut()}><LogOut size={17} /><span>Sair</span></button></div>
    </aside>
    {mobileNav && <button className="nav-overlay" onClick={() => setMobileNav(false)} aria-label="Fechar navegação" />}
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="Abrir menu"><Menu size={20} /></button><div><p className="eyebrow">SECURITY OPERATIONS</p><h1>{navItems.find((item) => item.id === view)?.label}</h1></div><div className="top-actions"><span className="live-indicator"><span className="pulse" /> ao vivo</span><button className="icon-button" onClick={() => void refreshData()} disabled={loading} aria-label="Atualizar dados"><RefreshCw size={17} className={loading ? "spin" : ""} /></button></div></header>
      {apiError && <div className="notice error"><AlertTriangle size={16} />{apiError}</div>}
      {view === "overview" && <Overview stats={stats} logs={logs} endpoints={endpoints} onNavigate={setView} />}
      {view === "logs" && <LogsView logs={logs} />}
      {view === "surface" && <SurfaceView endpoints={endpoints} />}
      {view === "cspm" && <CspmView summary={cspm} />}
      {view === "security" && <SecurityScoreView score={securityScore} onDownload={downloadReport} />}
      {view === "settings" && <SettingsView config={config} setConfig={setConfig} onSubmit={saveConfig} />}
    </main>
  </div>;
}

function formatAuthError(reason: unknown) { const message = reason instanceof Error ? reason.message : typeof reason === "object" && reason !== null && "message" in reason ? String(reason.message) : "Não foi possível autenticar"; if (message.includes("over_email_send_rate_limit")) return "O limite de envio de e-mails do Supabase foi atingido. Aguarde antes de tentar novamente ou desative a confirmação de e-mail no projeto de desenvolvimento."; return message; }
function LoginScreen({ error, onError }: { error: string; onError: (value: string) => void }) { const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [signUp, setSignUp] = useState(false); async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); onError(""); try { const supabase = createSupabaseBrowserClient(); const result = signUp ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; if (signUp) onError("Verifique seu e-mail para confirmar o acesso."); } catch (reason) { onError(formatAuthError(reason)); } finally { setBusy(false); } } return <div className="auth-shell"><div className="auth-grid"><div className="auth-intro"><div className="brand"><span className="brand-mark"><Shield size={17} /></span><span>DurtOne</span></div><div className="auth-copy"><p className="eyebrow">SECURITY OPERATIONS</p><h1>Clareza quando a superfície muda.</h1><p>Monitore tráfego, bloqueios e APIs que escapam da documentação em um só lugar.</p></div><div className="auth-foot"><span className="pulse" /> Control Plane operacional</div></div><form className="auth-form" onSubmit={submit}><div><p className="eyebrow">CONTROL PLANE</p><h2>{signUp ? "Criar acesso" : "Entrar no workspace"}</h2><p className="muted">Use suas credenciais Supabase para continuar.</p></div><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={signUp ? "new-password" : "current-password"} /></label>{error && <div className="notice error">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? "Aguarde..." : signUp ? "Criar conta" : "Acessar dashboard"}<ArrowUpRight size={16} /></button><button type="button" className="text-button" onClick={() => { setSignUp(!signUp); onError(""); }}>{signUp ? "Já tenho uma conta" : "Criar uma conta"}</button></form></div></div>; }
function Overview({ stats, logs, endpoints, onNavigate }: { stats: Stats; logs: RequestLog[]; endpoints: Endpoint[]; onNavigate: (view: View) => void }) { return <div className="content"><section className="hero-strip"><div><span className="section-kicker">POSTURA DO AMBIENTE</span><h2>Visibilidade sem ruído.</h2><p>Seu perímetro está sendo observado continuamente pelo DurtWall.</p></div><div className="hero-score"><span>Proteção ativa</span><strong>{stats.totalRequests ? `${Math.round((1 - stats.blockedRequests / stats.totalRequests) * 100)}%` : "--"}</strong><small>tráfego permitido</small></div></section><div className="metric-grid"><Metric label="Requisições" value={stats.totalRequests} delta="janela atual" icon={Activity} /><Metric label="Bloqueios WAF" value={stats.blockedRequests} delta="ameaças contidas" icon={Shield} accent="coral" /><Metric label="Endpoints" value={stats.discoveredEndpoints} delta="superfície observada" icon={Terminal} /><Metric label="Shadow APIs" value={stats.shadowApis} delta={stats.shadowApis ? "requer atenção" : "nenhum alerta"} icon={AlertTriangle} accent={stats.shadowApis ? "coral" : "mint"} /></div><div className="section-heading"><div><span className="section-kicker">ATIVIDADE RECENTE</span><h3>O que está acontecendo</h3></div><button className="text-button" onClick={() => onNavigate("logs")}>Ver todos <ArrowUpRight size={14} /></button></div><div className="lower-grid"><div className="panel event-panel">{logs.length ? logs.slice(0, 5).map((log) => <EventRow key={log.id} log={log} />) : <EmptyState label="Nenhum evento recebido ainda" />}</div><div className="panel surface-panel"><div className="panel-heading"><span>Superfície API</span><button className="icon-button" onClick={() => onNavigate("surface")} aria-label="Abrir superfície"><ArrowUpRight size={16} /></button></div>{endpoints.length ? endpoints.slice(0, 4).map((endpoint) => <div className="surface-row" key={`${endpoint.method}-${endpoint.path}`}><span className={`method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</span><code>{endpoint.path}</code><span className={endpoint.shadow ? "status-tag shadow" : "status-tag documented"}>{endpoint.shadow ? "shadow" : "documentado"}</span></div>) : <EmptyState label="Aguardando descoberta de endpoints" />}</div></div></div>; }
function Metric({ label, value, delta, icon: Icon, accent = "teal" }: { label: string; value: number; delta: string; icon: typeof Activity; accent?: string }) { return <div className={`metric-card ${accent}`}><div className="metric-icon"><Icon size={17} /></div><span>{label}</span><strong>{value.toLocaleString("pt-BR")}</strong><small>{delta}</small></div>; }
function EventRow({ log }: { log: RequestLog }) { return <div className="event-row"><span className={log.blocked ? "event-dot blocked" : "event-dot"} /><div className="event-main"><strong>{log.blocked ? "Requisição bloqueada" : "Requisição observada"}</strong><code>{log.method} {log.path}</code></div><span className={log.blocked ? "status-code blocked" : "status-code"}>{log.status}</span><time>{new Date(log.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></div>; }
function LogsView({ logs }: { logs: RequestLog[] }) { return <div className="content"><div className="section-heading"><div><span className="section-kicker">TRÁFEGO</span><h3>Eventos do perímetro</h3></div><span className="count-label">{logs.length} eventos</span></div><div className="panel table-panel"><div className="table-head"><span>Evento</span><span>Origem</span><span>Status</span><span>Horário</span></div>{logs.length ? logs.map((log) => <div className="table-row" key={log.id}><div className="event-main"><strong>{log.blocked ? "Bloqueado pelo WAF" : "Tráfego permitido"}</strong><code>{log.method} {log.path}</code></div><span>{log.remoteIp}</span><span className={log.blocked ? "status-code blocked" : "status-code"}>{log.status}</span><time>{new Date(log.timestamp).toLocaleString("pt-BR")}</time></div>) : <EmptyState label="Nenhum log disponível" />}</div></div>; }
function SurfaceView({ endpoints }: { endpoints: Endpoint[] }) { return <div className="content"><div className="section-heading"><div><span className="section-kicker">DURTSHIELD</span><h3>Superfície de API</h3></div><span className="count-label">{endpoints.filter((endpoint) => endpoint.shadow).length} shadow</span></div><div className="panel table-panel"><div className="table-head surface-head"><span>Endpoint</span><span>Acessos</span><span>Status</span></div>{endpoints.length ? endpoints.map((endpoint) => <div className="table-row surface-table-row" key={`${endpoint.method}-${endpoint.path}`}><div><span className={`method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</span><code>{endpoint.path}</code></div><span>{endpoint.count.toLocaleString("pt-BR")}</span><span className={endpoint.shadow ? "status-tag shadow" : "status-tag documented"}>{endpoint.shadow ? "Shadow API" : "Documentado"}</span></div>) : <EmptyState label="Nenhum endpoint descoberto" />}</div></div>; }
function CspmView({ summary }: { summary: CspmSummary | null }) { const metrics = summary ?? { provider: "aws", accountId: "n/a", postureScore: 0, totalChecks: 0, passChecks: 0, failChecks: 0, criticalFindings: 0, driftCount: 0, lastScanAt: new Date().toISOString(), drifts: [] };
  return <div className="content"><div className="section-heading"><div><span className="section-kicker">DURTGUARDIAN</span><h3>CSPM e drift</h3></div><span className="count-label">{metrics.provider}/{metrics.accountId}</span></div><div className="metric-grid"><Metric label="Postura" value={metrics.postureScore} delta="score global" icon={Gauge} accent="teal" /><Metric label="Checks" value={metrics.totalChecks} delta={`${metrics.passChecks} OK`} icon={CheckCircle2} accent="mint" /><Metric label="Falhas" value={metrics.failChecks} delta={`${metrics.criticalFindings} críticas`} icon={AlertTriangle} accent="coral" /><Metric label="Drifts" value={metrics.driftCount} delta="mudanças detectadas" icon={Shield} accent="yellow" /></div><div className="panel table-panel"><div className="table-head"><span>Recurso</span><span>Tipo</span><span>Antes</span><span>Depois</span></div>{metrics.drifts.length ? metrics.drifts.map((drift) => <div className="table-row" key={`${drift.resource}-${drift.kind}`}><div className="event-main"><strong>{drift.resource}</strong><code>{new Date(metrics.lastScanAt).toLocaleString("pt-BR")}</code></div><span className={drift.kind === "new" ? "status-tag shadow" : drift.kind === "missing" ? "status-tag documented" : "status-tag"}>{drift.kind}</span><span>{drift.before ?? "—"}</span><span>{drift.after ?? "—"}</span></div>) : <EmptyState label="Sem drifts detectados" />}</div></div>; }
function SecurityScoreView({ score, onDownload }: { score: SecurityScore | null; onDownload: () => void }) { const current = score ?? { score: 0, components: { waf: 0, cspm: 0, itdr: 0 }, weights: { waf: 0.4, cspm: 0.3, itdr: 0.3 } }; return <div className="content"><div className="section-heading"><div><span className="section-kicker">CORRELAÇÃO</span><h3>Security Score unificado</h3><p className="muted">WAF, postura cloud e higiene de identidades em uma única leitura.</p></div><button className="primary-button" onClick={onDownload}>Baixar relatório</button></div><section className="hero-strip"><div><span className="section-kicker">POSTURA GERAL</span><h2>{current.score}/100</h2><p>Score calculado a partir da telemetria mais recente.</p></div><div className="hero-score"><span>Prioridade</span><strong>{current.score < 60 ? "Alta" : current.score < 80 ? "Média" : "Baixa"}</strong><small>risco agregado</small></div></section><div className="metric-grid"><Metric label="DurtWall" value={current.components.waf} delta="eficácia WAF" icon={Shield} accent="teal" /><Metric label="DurtGuardian" value={current.components.cspm} delta="postura CSPM" icon={Gauge} accent="mint" /><Metric label="DurtScope" value={current.components.itdr} delta="higiene ITDR" icon={Activity} accent="yellow" /></div></div>; }
function SettingsView({ config, setConfig, onSubmit }: { config: Config; setConfig: (config: Config) => void; onSubmit: (event: FormEvent) => void }) { return <div className="content settings-content"><div className="section-heading"><div><span className="section-kicker">AGENTES</span><h3>Configuração operacional</h3><p className="muted">Defina o perímetro e o conector de identidade que o DurtScope deve consultar.</p></div></div><form className="panel settings-panel" onSubmit={onSubmit}><label>Upstream da aplicação<input type="url" value={config.upstream} onChange={(event) => setConfig({ ...config, upstream: event.target.value })} required /></label><div><span className="field-label">Modo de operação</span><div className="segmented">{(["block", "monitor"] as const).map((mode) => <button type="button" key={mode} className={config.mode === mode ? "selected" : ""} onClick={() => setConfig({ ...config, mode })}>{mode === "block" ? "Bloquear ameaças" : "Somente monitorar"}</button>)}</div></div><label>Webhook de alertas <span className="optional">opcional</span><input type="url" value={config.alertWebhookUrl ?? ""} onChange={(event) => setConfig({ ...config, alertWebhookUrl: event.target.value })} placeholder="https://hooks.slack.com/..." /></label><div className="identity-config"><div><span className="field-label">Provider de identidade</span><select value={config.identityProvider} onChange={(event) => setConfig({ ...config, identityProvider: event.target.value as Config["identityProvider"] })}><option value="none">Desativado</option><option value="keycloak">Keycloak</option><option value="okta">Okta</option><option value="aws">AWS IAM</option><option value="google">Google Workspace</option></select></div>{config.identityProvider !== "none" && <><label>Base URL <span className="optional">Keycloak/Okta/Google</span><input type="url" value={config.identityBaseUrl ?? ""} onChange={(event) => setConfig({ ...config, identityBaseUrl: event.target.value })} placeholder="https://identity.example.com" /></label><label>{config.identityProvider === "keycloak" ? "Realm" : config.identityProvider === "google" ? "Customer ID" : config.identityProvider === "aws" ? "Região" : "Org"}<input value={config.identityProvider === "keycloak" ? config.identityRealm ?? "" : config.identityProvider === "google" ? config.identityTenant ?? "" : config.identityProvider === "aws" ? config.identityRegion ?? "" : config.identityTenant ?? ""} onChange={(event) => setConfig({ ...config, ...(config.identityProvider === "keycloak" ? { identityRealm: event.target.value } : config.identityProvider === "google" ? { identityTenant: event.target.value } : config.identityProvider === "aws" ? { identityRegion: event.target.value } : { identityTenant: event.target.value }) })} required /></label><label>{config.identityProvider === "aws" ? "Access key ID" : "Client ID"}<input value={config.identityClientId ?? ""} onChange={(event) => setConfig({ ...config, identityClientId: event.target.value })} autoComplete="off" /></label><label>Secret ou access token<input type="password" value={config.identityProvider === "google" ? config.identityAccessToken ?? "" : config.identityClientSecret ?? ""} onChange={(event) => setConfig({ ...config, ...(config.identityProvider === "google" ? { identityAccessToken: event.target.value } : { identityClientSecret: event.target.value }) })} placeholder="Não será exibido novamente" autoComplete="new-password" /></label></>}</div><div className="form-actions"><span className="muted">Credenciais são mascaradas nas respostas do Control Plane.</span><button className="primary-button" type="submit"><Save size={16} /> Salvar configuração</button></div></form></div>; }
function EmptyState({ label }: { label: string }) { return <div className="empty-state"><FileSearch size={18} /><span>{label}</span></div>; }
