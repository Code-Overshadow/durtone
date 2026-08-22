import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  slug: varchar('slug', { length: 160 }).notNull().unique(),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps,
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: varchar('email', { length: 320 }).notNull(),
  ...timestamps,
});

export const userTenants = pgTable('user_tenants', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  role: varchar('role', { length: 24 }).default('member').notNull(),
  ...timestamps,
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.tenantId] }),
}));

export const configs = pgTable('configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  upstream: text('upstream').notNull(),
  port: integer('port').default(8080).notNull(),
  mode: varchar('mode', { length: 16 }).default('monitor').notNull(),
  customRules: text('custom_rules'),
  alertWebhookUrl: text('alert_webhook_url'),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps,
});

export const logs = pgTable('logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  path: text('path').notNull(),
  status: integer('status').notNull(),
  remoteIp: varchar('remote_ip', { length: 64 }),
  blocked: boolean('blocked').default(false).notNull(),
  reason: varchar('reason', { length: 120 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const endpoints = pgTable('endpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  path: text('path').notNull(),
  count: integer('count').default(0).notNull(),
  statusCodes: jsonb('status_codes').$type<Record<string, number>>().default({}).notNull(),
  documented: boolean('documented').default(false).notNull(),
  shadow: boolean('shadow').default(true).notNull(),
  ...timestamps,
}, (table) => ({
  tenantMethodPathUnique: uniqueIndex('endpoints_tenant_method_path_unique').on(table.tenantId, table.method, table.path),
}));

export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 64 }).notNull(),
  severity: varchar('severity', { length: 16 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const scans = pgTable('scans', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  provider: varchar('provider', { length: 32 }).notNull(),
  accountId: varchar('account_id', { length: 160 }).notNull(),
  status: varchar('status', { length: 24 }).notNull(),
  findings: jsonb('findings').$type<Record<string, unknown>>().default({}).notNull(),
  baselineHash: varchar('baseline_hash', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const drifts = pgTable('drifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  scanId: uuid('scan_id').references(() => scans.id, { onDelete: 'cascade' }).notNull(),
  resource: varchar('resource', { length: 255 }).notNull(),
  before: jsonb('before').$type<Record<string, unknown>>().default({}).notNull(),
  after: jsonb('after').$type<Record<string, unknown>>().default({}).notNull(),
  resolved: boolean('resolved').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cloudAccounts = pgTable('cloud_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  provider: varchar('provider', { length: 32 }).notNull(),
  accountId: varchar('account_id', { length: 160 }).notNull(),
  displayName: varchar('display_name', { length: 160 }).notNull(),
  credentialRef: text('credential_ref').notNull(),
  regions: jsonb('regions').$type<string[]>().default([]).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
  ...timestamps,
}, (table) => ({
  tenantProviderAccountUnique: uniqueIndex('cloud_accounts_tenant_provider_account_unique').on(table.tenantId, table.provider, table.accountId),
}));

export const identityProviders = pgTable('identity_providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  kind: varchar('kind', { length: 32 }).notNull(),
  displayName: varchar('display_name', { length: 160 }).notNull(),
  baseUrl: text('base_url'),
  realmOrTenant: varchar('realm_or_tenant', { length: 160 }),
  region: varchar('region', { length: 64 }),
  clientId: varchar('client_id', { length: 320 }),
  credentialRef: text('credential_ref').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  ...timestamps,
});

export const identities = pgTable('identities', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  providerId: uuid('provider_id').references(() => identityProviders.id, { onDelete: 'cascade' }).notNull(),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  kind: varchar('kind', { length: 24 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  permissions: jsonb('permissions').$type<string[]>().default([]).notNull(),
  ipAddresses: jsonb('ip_addresses').$type<string[]>().default([]).notNull(),
  riskScore: integer('risk_score').default(0).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  ...timestamps,
}, (table) => ({
  providerExternalIdUnique: uniqueIndex('identities_provider_external_id_unique').on(table.providerId, table.externalId),
}));

export const tenantInvitations = pgTable('tenant_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  role: varchar('role', { length: 24 }).default('member').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  actorType: varchar('actor_type', { length: 16 }).notNull(),
  actorId: varchar('actor_id', { length: 160 }).notNull(),
  action: varchar('action', { length: 120 }).notNull(),
  targetType: varchar('target_type', { length: 64 }),
  targetId: varchar('target_id', { length: 160 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  previousHash: varchar('previous_hash', { length: 64 }),
  hash: varchar('hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const domains = pgTable('domains', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  hostname: varchar('hostname', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 24 }).default('pending_dns').notNull(),
  certificateStatus: text('certificate_status'),
  errorMessage: text('error_message'),
  ...timestamps,
});

export const tenantRelations = relations(tenants, ({ many }) => ({
  userTenants: many(userTenants),
  configs: many(configs),
  logs: many(logs),
  endpoints: many(endpoints),
  alerts: many(alerts),
  scans: many(scans),
  drifts: many(drifts),
  cloudAccounts: many(cloudAccounts),
  identityProviders: many(identityProviders),
  identities: many(identities),
  tenantInvitations: many(tenantInvitations),
  auditLogs: many(auditLogs),
  domains: many(domains),
}));

export const domainRelations = relations(domains, ({ one }) => ({
  tenant: one(tenants, { fields: [domains.tenantId], references: [tenants.id] }),
}));

export const userRelations = relations(users, ({ many }) => ({
  userTenants: many(userTenants),
}));

export const userTenantRelations = relations(userTenants, ({ one }) => ({
  user: one(users, { fields: [userTenants.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [userTenants.tenantId], references: [tenants.id] }),
}));

export const configRelations = relations(configs, ({ one }) => ({
  tenant: one(tenants, { fields: [configs.tenantId], references: [tenants.id] }),
}));

export const cloudAccountRelations = relations(cloudAccounts, ({ one }) => ({
  tenant: one(tenants, { fields: [cloudAccounts.tenantId], references: [tenants.id] }),
}));

export const identityProviderRelations = relations(identityProviders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [identityProviders.tenantId], references: [tenants.id] }),
  identities: many(identities),
}));

export const identityRelations = relations(identities, ({ one }) => ({
  tenant: one(tenants, { fields: [identities.tenantId], references: [tenants.id] }),
  provider: one(identityProviders, { fields: [identities.providerId], references: [identityProviders.id] }),
}));

export const tenantInvitationRelations = relations(tenantInvitations, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantInvitations.tenantId], references: [tenants.id] }),
  invitedByUser: one(users, { fields: [tenantInvitations.invitedBy], references: [users.id] }),
}));

export const auditLogRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [auditLogs.tenantId], references: [tenants.id] }),
}));