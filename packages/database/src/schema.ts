import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
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
  ...timestamps,
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  ...timestamps,
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  keyHash: text('key_hash').notNull().unique(),
  revoked: boolean('revoked').default(false).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  ...timestamps,
});

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

export const tenantRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  apiKeys: many(apiKeys),
  configs: many(configs),
  logs: many(logs),
  endpoints: many(endpoints),
  alerts: many(alerts),
  scans: many(scans),
  drifts: many(drifts),
}));

export const userRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
}));

export const configRelations = relations(configs, ({ one }) => ({
  tenant: one(tenants, { fields: [configs.tenantId], references: [tenants.id] }),
}));