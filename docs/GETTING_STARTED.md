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

5. Create an agent enrollment token through `POST /api/v1/agents/enrollment` and configure the token in the agent environment.

The full PowerShell smoke test is documented in the root README.

## Production prerequisites

Before production deployment, configure Supabase Auth, a production PostgreSQL database, Upstash Redis, secret storage, TLS, a release registry, backups, and a real monitoring provider. Never use `.env.dev` in production.

## Release checks

```powershell
bun run --filter "*" check
bun test apps/api/src apps/durtscope/src apps/durtguardian/src packages/crypto/src
cd agents/durtwall
 go test ./...
 go vet ./...
```
