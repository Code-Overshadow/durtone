import Link from "next/link";
import { ArrowUpRight, Check, Shield, ScanSearch, Zap } from "lucide-react";

const capabilities = [
  "Bloqueio OWASP com Coraza e CRS",
  "Descoberta de Shadow APIs em tempo real",
  "Logs e score de postura em um único painel",
];

export default function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav">
        <Link className="landing-brand" href="/landing"><span className="landing-mark"><Shield size={16} /></span>DurtOne</Link>
        <div className="landing-nav-links"><a href="#capabilities">Capacidades</a><a href="#pricing">Acesso</a><Link href="/">Entrar <ArrowUpRight size={14} /></Link></div>
      </nav>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">SECURITY OPERATIONS FOR SMBs</p>
          <h1>Veja o que muda antes que vire incidente.</h1>
          <p className="landing-lede">DurtOne combina WAF, descoberta de APIs e postura de segurança em uma operação clara para equipes enxutas.</p>
          <div className="landing-actions"><Link className="landing-primary" href="/">Abrir Control Plane <ArrowUpRight size={16} /></Link><a className="landing-secondary" href="#capabilities">Conhecer a plataforma</a></div>
        </div>
        <div className="landing-visual" aria-label="Resumo visual da operação DurtOne">
          <div className="visual-top"><span><span className="pulse" /> ambiente protegido</span><strong>82</strong></div>
          <div className="visual-chart"><span className="chart-label">POSTURA DE SEGURANÇA</span><div className="chart-bars"><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="chart-axis"><span>00:00</span><span>agora</span></div></div>
          <div className="visual-alert"><span className="visual-icon"><ScanSearch size={16} /></span><div><strong>Shadow API detectada</strong><small>GET /internal/export</small></div><span className="alert-tag">revisar</span></div>
        </div>
      </section>
      <section className="landing-section" id="capabilities"><div className="landing-section-heading"><p className="eyebrow">UMA CAMADA DE CLAREZA</p><h2>Proteção que conversa com a realidade do seu ambiente.</h2></div><div className="capability-grid"><article><Zap size={19} /><h3>DurtWall</h3><p>Proxy reverso com inspeção WAF, rate limiting e logs estruturados.</p></article><article><ScanSearch size={19} /><h3>DurtShield</h3><p>Descubra endpoints acessados que não aparecem no contrato OpenAPI.</p></article><article><Shield size={19} /><h3>Control Plane</h3><p>Configuração, eventos e postura em um painel operacional, sem ruído.</p></article></div></section>
      <section className="landing-proof"><div><p className="eyebrow">COMECE PELO MVP</p><h2>O essencial para reduzir superfície e responder mais rápido.</h2></div><ul>{capabilities.map((capability) => <li key={capability}><Check size={16} />{capability}</li>)}</ul></section>
      <section className="landing-cta" id="pricing"><div><p className="eyebrow">ACESSO</p><h2>Pronto para observar seu primeiro ambiente.</h2><p>Use o Control Plane localmente, conecte um agente e veja a superfície ganhar forma.</p></div><Link className="landing-primary" href="/">Entrar no workspace <ArrowUpRight size={16} /></Link></section>
      <footer className="landing-footer"><span>DurtOne Security Suite</span><span>WAF · API Discovery · Security Operations</span></footer>
    </main>
  );
}
