CREATE UNIQUE INDEX IF NOT EXISTS "endpoints_tenant_method_path_unique" ON "endpoints" ("tenant_id", "method", "path");
