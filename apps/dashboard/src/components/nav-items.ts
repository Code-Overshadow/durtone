import { Activity, FileSearch, Gauge, LayoutGrid, Shield, UsersRound } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Visão geral", icon: Gauge },
  { href: "/dashboard/logs", label: "Eventos", icon: Activity },
  { href: "/dashboard/surface", label: "Superfície API", icon: FileSearch },
  { href: "/dashboard/cspm", label: "CSPM", icon: Shield },
  { href: "/dashboard/security", label: "Security Score", icon: Gauge },
  { href: "/dashboard/services", label: "Serviços", icon: LayoutGrid },
  { href: "/dashboard/account/tenant", label: "Conta", icon: UsersRound },
];

export const ACCOUNT_NAV_ITEMS = [
  { href: "/dashboard/account/tenant", label: "Tenant" },
  { href: "/dashboard/account/users", label: "Usuários" },
];
