"use client";

import Link from "next/link";
import { ChevronLeft, FileSearch, HelpCircle, RefreshCw } from "lucide-react";
import { requestRefresh } from "@/lib/refresh-bus";

export function EmptyState({ label }: { label: string }) {
  return <div className="empty-state"><FileSearch size={18} /><span>{label}</span></div>;
}

export function ServiceBackLink() {
  return <Link href="/dashboard/services" className="text-button" style={{ marginBottom: 14 }}><ChevronLeft size={14} /> Serviços</Link>;
}

export function HelpCallout({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="help-callout">
    <HelpCircle size={16} />
    <div><strong>{title}</strong>{children}</div>
  </div>;
}

export function Metric({ label, value, delta, icon: Icon, accent = "teal" }: { label: string; value: number; delta: string; icon: typeof FileSearch; accent?: string }) {
  return <div className={`metric-card ${accent}`}><div className="metric-icon"><Icon size={17} /></div><span>{label}</span><strong>{value.toLocaleString("pt-BR")}</strong><small>{delta}</small></div>;
}

export function SectionHeading({ kicker, title, description, count, actions }: { kicker: string; title: string; description?: string; count?: string; actions?: React.ReactNode }) {
  return <div className="section-heading">
    <div><span className="section-kicker">{kicker}</span><h3>{title}</h3>{description && <p className="muted">{description}</p>}</div>
    {count && <span className="count-label">{count}</span>}
    {actions}
  </div>;
}

export function RefreshButton({ loading }: { loading: boolean }) {
  return <button className="icon-button" onClick={requestRefresh} disabled={loading} aria-label="Atualizar dados">
    <RefreshCw size={17} className={loading ? "spin" : ""} />
  </button>;
}
