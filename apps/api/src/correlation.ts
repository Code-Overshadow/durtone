export type CorrelationIdentity = {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'inactive';
  permissions: string[];
  ipAddresses?: string[];
};

export type WafAttack = {
  remoteIp: string;
  blocked: boolean;
  path?: string;
  reason?: string;
};

export type CspmChange = {
  resource: string;
  kind: 'changed' | 'new' | 'missing';
  actorIdentityId?: string;
  requiredPermission?: string;
};

export function correlateWafAttack(attack: WafAttack, identities: CorrelationIdentity[]) {
  const matches = identities.filter((identity) => identity.ipAddresses?.includes(attack.remoteIp));
  return {
    attack,
    matches,
    action: attack.blocked && matches.some((identity) => identity.status === 'active') ? 'revoke-active-matches' as const : 'observe',
  };
}

export function correlateGuardianChange(change: CspmChange, identities: CorrelationIdentity[]) {
  const matches = identities.filter((identity) => {
    if (change.actorIdentityId && identity.id === change.actorIdentityId) return true;
    if (!change.requiredPermission) return false;
    return identity.permissions.some((permission) => permission.toLowerCase() === change.requiredPermission?.toLowerCase());
  });

  return {
    change,
    matches,
    action: matches.length ? 'audit-identity' as const : 'unattributed-change' as const,
  };
}
