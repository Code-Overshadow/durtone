import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (use --env-file=.env.dev)');
  process.exit(1);
}

const tenantId = process.env.DURTONE_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
const sql = postgres(databaseUrl);

await sql`
  insert into tenants (id, name, slug)
  values (${tenantId}, 'Local Dev Tenant', 'local-dev')
  on conflict (id) do nothing
`;

console.log(`Seeded local dev tenant ${tenantId}`);
await sql.end();
