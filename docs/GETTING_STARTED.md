# DurtOne Getting Started

## MVP local

1. Start PostgreSQL and Redis (defined in the root `docker-compose.yml`):

```powershell
bun run db:up
# or: docker compose up -d
```

2. Start the Control Plane:

```powershell
cd apps/api
bun --env-file=.env.dev --watch src/index.ts
```

3. In a second terminal, start the dashboard:

```powershell
cd apps/dashboard
bun run dev
```

4. Open the public page at `http://localhost:3001/landing` or the authenticated Control Plane at `http://localhost:3001/`.

5. There's no agent to enroll anymore - DurtWall is a managed edge proxy fleet (`apps/durtwall`), not something the client installs. To exercise it locally, set `EDGE_FLEET_TOKEN` on the API, insert an `active` row in `domains`/`configs` for a test hostname, and run `apps/durtwall` with `DURTWALL_CONTROL_PLANE_URL`/`DURTWALL_FLEET_TOKEN` pointed at the local API - see the root README's "Ambiente de desenvolvimento local" section.

The full PowerShell smoke test is documented in the root README.

## Production prerequisites

Before production deployment, configure Supabase Auth, a production PostgreSQL database, Upstash Redis, secret storage, a domain customers can CNAME to for the edge fleet, `FLY_API_TOKEN`/`FLY_APP_NAME` (customer domain TLS certificates), `EDGE_FLEET_TOKEN`, backups, and a real monitoring provider. Never use `.env.dev` in production.

## Release checks

```powershell
bun run --filter "*" check
bun test apps/api/src apps/durtscope/src apps/durtguardian/src packages/crypto/src packages/identity-providers/src
cd apps/durtwall
 go test ./...
 go vet ./...
```
