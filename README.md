# DurtOne

Monorepo do DurtOne, Security Suite modular 100% cloud: WAF+Deception (DurtWall/DurtShield), CSPM
(DurtGuardian) e ITDR (DurtScope). Nenhum módulo é instalado pelo cliente - DurtGuardian/DurtScope
rodam centralizados na nossa infra usando credenciais que o cliente cadastra no dashboard, e o
DurtWall é um fleet de proxy gerenciado: o cliente aponta o DNS do próprio domínio (CNAME) pra
gente, sem instalar nada.

## Desenvolvimento local

Forma mais rápida de subir tudo (a partir da raiz do monorepo):

```powershell
bun install
bun run db:up   # sobe Postgres (55432) e Redis (56379) locais via Docker Compose
bun run dev     # sobe API (3000) e dashboard (3001) juntos
```

Use `bun run dev:all` para incluir também `durtguardian` e `durtscope`.

Se preferir rodar cada app isoladamente:

API Control Plane:

```powershell
cd apps/api
bun install
bun run dev
```

A API inicia em `http://localhost:3000`. Por padrão ela usa `.env.local` (Supabase/Postgres reais, se configurados). Para usar o Postgres/Redis locais do Docker Compose em vez de serviços reais, use `bun --env-file=.env.dev --watch src/index.ts` (veja a seção "Ambiente de desenvolvimento local" abaixo).

Dashboard:

```powershell
cd apps/dashboard
bun install
bun run dev
```

O dashboard inicia em `http://localhost:3001`. Rotas reais do Next.js App Router (`apps/dashboard/src/app/(dashboard)`): `/` (visão geral), `/logs`, `/surface`, `/cspm`, `/security` e `/settings/{waf,domains,cspm,itdr,tenant,users}` - as duas últimas seções de `/settings` (contas cloud e provedores de identidade) fazem CRUD completo contra `/api/v1/cloud-accounts` e `/api/v1/identity-providers`.

DurtWall (fleet de edge proxy - roda na nossa infra, não na do cliente):

```powershell
cd apps/durtwall
go run .
```

Defina `PORT` para uma porta alternativa quando necessário, por exemplo `$env:PORT = "18080"`.

O DurtWall aceita `config.yaml` com `port`, `rate_limit`, `rate_burst`, `request_body_max`, `rules_file`, `log_file`, `control_plane_url` e `fleet_token`. Ele carrega o OWASP CRS embutido via Coraza (motor compartilhado por todos os tenants nesta fase) e escreve logs JSON em stdout ou no arquivo configurado. **Não há mais `upstream`/`mode` no YAML** - isso vem por tenant da tabela de roteamento (ver abaixo), porque um único processo serve o domínio de qualquer tenant, resolvido pelo `Host` da requisição.

### Tabela de roteamento (substitui o antigo enrollment por tenant)

Com `control_plane_url`/`fleet_token` configurados, o DurtWall busca `GET /api/v1/edge/routing-table` a cada 15s - a lista de todos os domínios `active` com o config mais recente do tenant de cada um - e substitui a tabela inteira a cada poll (sem downtime, troca atômica). Cada requisição resolve o tenant pelo `Host` header; um `Host` sem domínio ativo correspondente recebe 404. `fleet_token` é um segredo único compartilhado entre a API e todo o fleet (`EDGE_FLEET_TOKEN` no `.env` da API) - não é mais um token por tenant.

Logs são enviados por `POST /api/v1/ingest/logs` com o mesmo `fleet_token`, e cada entrada carrega o `tenantId` resolvido (a API persiste cada uma no tenant certo).

DurtShield (análise de logs pra descobrir endpoints, roda em modo standalone/local, não pela tabela de roteamento):

```powershell
cd apps/durtwall
go run . -discover -logs durtwall.jsonl -openapi openapi.json -output endpoints.json
```

O callback de honeytokens está disponível em `POST /api/v1/honeytokens/callback`; os eventos recentes podem ser consultados em `GET /api/v1/honeytokens/callbacks`. Honeytokens e modo stealth agora são configuráveis por tenant (`settings.honeytokens`/`settings.stealth` na tabela de roteamento). Honeypot dinâmico roda no fleet gerenciado via um honeypot **sintético** (fabrica a resposta em processo, usando os endpoints que o DurtShield já descobriu daquele tenant, sem precisar de container/VM) - a versão anterior via Docker SDK continua existindo pra uso standalone/local, e ambas implementam a mesma interface pra permitir plugar uma versão baseada na Fly Machines API depois. Detalhes em `apps/durtwall/README.md`.

DurtGuardian (CSPM) e DurtScope (ITDR) também rodam centralizados - consultam `cloud_accounts`/`identity_providers` de todos os tenants direto no Postgres (sem token de agente, sem push HTTP) e persistem `scans`/`identities` direto. `GET /api/v1/security/score` (score ponderado WAF/CSPM/ITDR) e `GET /api/v1/security/report.pdf` usam esses dados persistidos.

## Banco de dados

O schema Drizzle está em `packages/database/src/schema.ts` e a migration inicial em `packages/database/drizzle`.
Configure `DATABASE_URL` com um PostgreSQL/Supabase de desenvolvimento antes de aplicar migrations. Nunca versionar credenciais reais.

## Ambiente de desenvolvimento local

Os containers usados no desenvolvimento (`durtone-postgres-dev` em `localhost:55432` e `durtone-redis-dev` em `localhost:56379`) são definidos em `docker-compose.yml` na raiz. Suba-os com:

```powershell
bun run db:up    # ou: docker compose up -d
```

Eles podem permanecer ativos entre sessões (`bun run db:down` para parar). Aplique as migrations (ainda não há um runner automático — é feito diretamente no Postgres do container) e semeie o tenant local de desenvolvimento:

```powershell
cd packages/database/drizzle
Get-ChildItem *.sql | Sort-Object Name | ForEach-Object { Get-Content $_.FullName -Raw | docker exec -i durtone-postgres-dev psql -U postgres -d durtone -v ON_ERROR_STOP=1 }
cd ../../../apps/api
bun run db:seed
```

`bun run db:seed` cria a linha em `tenants` com o id de `DURTONE_TENANT_ID` (`00000000-0000-0000-0000-000000000001` por padrão) — sem isso, qualquer chamada que grave dado vinculado a esse tenant falha com violação de foreign key. É seguro rodar de novo a qualquer momento (idempotente).

Com isso feito, execute a API (defina `EDGE_FLEET_TOKEN` pra poder testar o fleet do DurtWall):

```powershell
cd apps/api
$env:EDGE_FLEET_TOKEN = "dev-fleet-token"
bun --env-file=.env.dev --watch src/index.ts
```

Smoke test básico:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Sem `FLY_API_TOKEN`/`FLY_APP_NAME` configurados, criar um domínio (`POST /api/v1/domains`) funciona mas fica em `pending_dns` com um erro claro em vez de emitir certificado de verdade — normal em dev local. Pra testar o fleet do DurtWall ponta a ponta localmente sem depender do Fly, insira uma linha em `configs`/`domains` direto no Postgres com `status = 'active'` e um hostname de teste, depois rode o proxy apontando pra API local:

```powershell
cd apps/durtwall
$env:DURTWALL_CONTROL_PLANE_URL = "http://localhost:3000"
$env:DURTWALL_FLEET_TOKEN = "dev-fleet-token"
go run . -config config.yaml
```

Requisições com `Host: <o-hostname-de-teste>` na porta do proxy (8080 por padrão) são roteadas pro `upstream` daquele tenant; qualquer outro `Host` recebe 404. Em staging/produção, configure Supabase Auth, `DURTONE_AUTH_REQUIRED=true`, Redis e secrets manager; não use `.env.dev`.

## Checks

```powershell
bun run --filter '*' check
cd apps/dashboard; bun run build
cd apps/durtwall; go vet ./...; go test ./...
```

O quality gate usa checks nativos por stack; PMD Java não se aplica ao monorepo Bun/Next.js/Go.

## MCP e deployments

O workspace possui MCPs para Vercel e Supabase em `.vscode/mcp.json`. O MCP da Vercel usa `VERCEL_TOKEN`; o MCP do Supabase exige um `SUPABASE_ACCESS_TOKEN` próprio, diferente da `SUPABASE_SERVICE_ROLE_KEY`.

O projeto Vercel usa `vercel.json` e o script `bun run vercel:deploy`. O deploy deve ser iniciado explicitamente após o projeto ser vinculado à conta correta.