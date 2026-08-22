import Link from "next/link";
import { ArrowUpRight, Check, Globe, ScanSearch, ShieldCheck, UserCog, Zap } from "lucide-react";

const capabilities = [
  "Bloqueio OWASP com Coraza e CRS, sem instalar nada",
  "Descoberta de Shadow APIs em tempo real",
  "Postura de nuvem (CSPM) e higiene de identidades (ITDR) no mesmo lugar",
  "Aponte o DNS do seu domínio e pronto — TLS automático",
];

const services = [
  { icon: Zap, name: "DurtWall", description: "WAF e rate limiting gerenciados. O tráfego do seu domínio passa por um proxy que bloqueia OWASP Top 10 sem você instalar nada." },
  { icon: ScanSearch, name: "DurtShield", description: "Descobre endpoints acessados de verdade e compara com seu contrato OpenAPI — Shadow APIs aparecem antes de virar incidente." },
  { icon: ShieldCheck, name: "DurtGuardian", description: "CSPM multi-cloud: varre AWS, Azure e GCP, detecta drift de configuração e calcula uma postura contínua." },
  { icon: UserCog, name: "DurtScope", description: "ITDR para identidades humanas e de serviço via Keycloak, Okta, AWS IAM e Google Workspace, com revogação real." },
];

export default function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav">
        <Link className="landing-brand" href="/"><span className="landing-mark"><Globe size={16} /></span>DurtOne</Link>
        <div className="landing-nav-links"><a href="#capabilities">Capacidades</a><a href="#pricing">Acesso</a><Link href="/dashboard">Entrar <ArrowUpRight size={14} /></Link></div>
      </nav>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">SECURITY OPERATIONS FOR SMBs</p>
          <h1>Veja o que muda antes que vire incidente.</h1>
          <p className="landing-lede">DurtOne combina WAF, descoberta de APIs, postura de nuvem e higiene de identidades em uma operação clara para equipes enxutas — 100% gerenciado, nada pra instalar.</p>
          <div className="landing-actions"><Link className="landing-primary" href="/dashboard">Abrir workspace <ArrowUpRight size={16} /></Link><a className="landing-secondary" href="#capabilities">Conhecer a plataforma</a></div>
        </div>
        <div className="landing-visual" aria-label="Resumo visual da operação DurtOne">
          <div className="visual-top"><span><span className="pulse" /> ambiente protegido</span><strong>82</strong></div>
          <div className="visual-chart"><span className="chart-label">POSTURA DE SEGURANÇA</span><div className="chart-bars"><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="chart-axis"><span>00:00</span><span>agora</span></div></div>
          <div className="visual-alert"><span className="visual-icon"><ScanSearch size={16} /></span><div><strong>Shadow API detectada</strong><small>GET /internal/export</small></div><span className="alert-tag">revisar</span></div>
        </div>
      </section>
      <section className="landing-section" id="capabilities">
        <div className="landing-section-heading"><p className="eyebrow">QUATRO MÓDULOS, UMA OPERAÇÃO</p><h2>Proteção que conversa com a realidade do seu ambiente.</h2></div>
        <div className="capability-grid">{services.map(({ icon: Icon, name, description }) => <article key={name}><Icon size={19} /><h3>{name}</h3><p>{description}</p></article>)}</div>
      </section>
      <section className="landing-proof"><div><p className="eyebrow">COMECE PELO MVP</p><h2>O essencial para reduzir superfície e responder mais rápido.</h2></div><ul>{capabilities.map((capability) => <li key={capability}><Check size={16} />{capability}</li>)}</ul></section>
      <section className="landing-cta" id="pricing"><div><p className="eyebrow">ACESSO</p><h2>Pronto para observar seu primeiro ambiente.</h2><p>Crie seu workspace, aponte o DNS do seu domínio e veja a superfície ganhar forma.</p></div><Link className="landing-primary" href="/dashboard">Entrar no workspace <ArrowUpRight size={16} /></Link></section>
      <footer className="landing-footer"><span>DurtOne Security Suite</span><span>WAF · API Discovery · CSPM · ITDR</span></footer>
    </main>
  );
}
