"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import type { Membership } from "@/components/dashboard-shell-context";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Membro" };

export function TenantSwitcher({ memberships, activeTenantId, onSwitch, onCreateNew }: { memberships: Membership[]; activeTenantId: string; onSwitch: (tenantId: string) => void; onCreateNew: () => void }) {
  const [open, setOpen] = useState(false);
  const active = memberships.find((membership) => membership.tenantId === activeTenantId);

  return <div style={{ position: "relative" }}>
    <button type="button" className="tenant-switch" onClick={() => setOpen((value) => !value)}>
      <span className="tenant-dot" />
      <span className="tenant-switch-name">{active?.name ?? "Selecionar workspace"}</span>
      <ChevronRight size={14} />
    </button>
    {open && <div className="tenant-switch-menu">
      {memberships.map((membership) => <button
        type="button"
        key={membership.tenantId}
        className={membership.tenantId === activeTenantId ? "tenant-switch-item active" : "tenant-switch-item"}
        onClick={() => { onSwitch(membership.tenantId); setOpen(false); }}
      >
        <span>{membership.name}</span>
        <small>{ROLE_LABEL[membership.role] ?? membership.role}</small>
      </button>)}
      <div className="tenant-switch-divider" />
      <button type="button" className="tenant-switch-item tenant-switch-create" onClick={() => { onCreateNew(); setOpen(false); }}>
        <Plus size={13} /> <span>Novo workspace</span>
      </button>
    </div>}
  </div>;
}
