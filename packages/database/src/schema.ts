import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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

export const tenantRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  apiKeys: many(apiKeys),
  configs: many(configs),
}));

export const userRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
}));

export const configRelations = relations(configs, ({ one }) => ({
  tenant: one(tenants, { fields: [configs.tenantId], references: [tenants.id] }),
}));