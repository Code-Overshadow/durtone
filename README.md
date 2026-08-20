# DurtOne

Monorepo inicial do DurtOne, Security Suite modular focado no MVP DurtWall + DurtShield.

## Desenvolvimento local

API Control Plane:

```powershell
cd apps/api
bun install
bun run dev
```

A API inicia em `http://localhost:3000`.

Dashboard:

```powershell
cd apps/dashboard
bun install
bun run dev
```

O dashboard inicia em `http://localhost:3000` (use outra porta se a API estiver ativa).

DurtWall:

```powershell
cd agents/durtwall
go run .
```

Defina `PORT` para uma porta alternativa quando necessário, por exemplo `$env:PORT = "18080"`.

## Banco de dados

O schema Drizzle está em `packages/database/src/schema.ts` e a migration inicial em `packages/database/drizzle`.
Configure `DATABASE_URL` com um PostgreSQL/Supabase de desenvolvimento antes de aplicar migrations. Nunca versionar credenciais reais.

## Checks

```powershell
bun run --filter '*' check
cd apps/dashboard; bun run build
cd agents/durtwall; go vet ./...; go test ./...
```

O quality gate usa checks nativos por stack; PMD Java não se aplica ao monorepo Bun/Next.js/Go.