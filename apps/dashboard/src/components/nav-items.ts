import { Activity, FileSearch, Gauge, Shield } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Visão geral", icon: Gauge },
  { href: "/logs", label: "Eventos", icon: Activity },
  { href: "/surface", label: "Superfície API", icon: FileSearch },
  { href: "/cspm", label: "CSPM", icon: Shield },
  { href: "/security", label: "Security Score", icon: Gauge },
  { href: "/settings/waf", label: "Configuração", icon: Shield },
];

export const SETTINGS_NAV_ITEMS = [
  { href: "/settings/waf", label: "WAF" },
  { href: "/settings/domains", label: "Domínios" },
  { href: "/settings/cspm", label: "Contas Cloud" },
  { href: "/settings/itdr", label: "Provedores de Identidade" },
  { href: "/settings/tenant", label: "Tenant" },
  { href: "/settings/users", label: "Usuários" },
];
