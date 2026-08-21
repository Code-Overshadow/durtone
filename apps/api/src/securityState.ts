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

let identities: SecurityIdentity[] = [];

export function replaceSecurityIdentities(payload: unknown) {
  const parsed = identitiesSchema.parse(payload);
  identities = Array.isArray(parsed) ? parsed : parsed.identities;
  return identities;
}

export function listSecurityIdentities() {
  return [...identities];
}

export function getIdentityHygiene() {
  const staleCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const staleIdentities = identities.filter((identity) => identity.lastSeen && Date.parse(identity.lastSeen) < staleCutoff).length;
  const highRiskIdentities = identities.filter((identity) => (identity.riskScore ?? 0) >= 70).length;
  return { totalIdentities: identities.length, highRiskIdentities, staleIdentities };
}

export function resetSecurityIdentities() {
  identities = [];
}
