import { z } from 'zod';

const identitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['active', 'suspended', 'inactive']),
  permissions: z.array(z.string()).default([]),
  ipAddresses: z.array(z.string()).optional(),
  riskScore: z.number().min(0).max(100).optional(),
  lastSeen: z.string().datetime().optional(),
});

const identitiesSchema = z.union([z.array(identitySchema), z.object({ identities: z.array(identitySchema) })]);
export type SecurityIdentity = z.infer<typeof identitySchema>;

const identitiesByTenant = new Map<string, SecurityIdentity[]>();

export function replaceSecurityIdentities(tenantId: string, payload: unknown) {
  const parsed = identitiesSchema.parse(payload);
  const identities = Array.isArray(parsed) ? parsed : parsed.identities;
  identitiesByTenant.set(tenantId, identities);
  return identities;
}

export function listSecurityIdentities(tenantId: string) {
  return [...(identitiesByTenant.get(tenantId) ?? [])];
}

export function getIdentityHygiene(tenantId: string) {
  const identities = identitiesByTenant.get(tenantId) ?? [];
  const staleCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const staleIdentities = identities.filter((identity) => identity.lastSeen && Date.parse(identity.lastSeen) < staleCutoff).length;
  const highRiskIdentities = identities.filter((identity) => (identity.riskScore ?? 0) >= 70).length;
  return { totalIdentities: identities.length, highRiskIdentities, staleIdentities };
}

export function resetSecurityIdentities(tenantId: string) {
  identitiesByTenant.delete(tenantId);
}
