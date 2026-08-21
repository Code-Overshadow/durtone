# DurtOne

Monorepo inicial do DurtOne, Security Suite modular focado no MVP DurtWall + DurtShield.

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

O dashboard inicia em `http://localhost:3001`.

DurtWall:

```powershell
cd agents/durtwall
go run .
```

Defina `PORT` para uma porta alternativa quando necessário, por exemplo `$env:PORT = "18080"`.

O DurtWall aceita `config.yaml` com `upstream`, `port`, `mode` (`block` ou `monitor`), `rate_limit`, `rate_burst`, `request_body_max`, `rules_file` e `log_file`. O agente carrega o OWASP CRS embutido via Coraza, aplica regras SecLang locais e escreve logs JSON em stdout ou no arquivo configurado.

Na Sprint 2 foram entregues o proxy reverso, inspeção WAF, token bucket por IP, configuração YAML, logs estruturados e builds Linux amd64/arm64. Descoberta de endpoints/DurtShield, TLS, decepção e integração com o Control Plane permanecem nas sprints seguintes.

Na Sprint 3 foram entregues o analisador DurtShield no agente e as rotas `POST /api/v1/ingest/logs`, `POST /api/v1/openapi` e `GET /api/v1/endpoints` no Control Plane. A agregação do Control Plane é em memória nesta etapa; a persistência nas tabelas `logs`/`endpoints`/`alerts` será adicionada com o repositório Drizzle.

Na Sprint 4 foram entregues detectores de scanners, honeypot dinâmico via Docker SDK, readiness/cleanup do container, injeção de honeytokens em JSON e modo stealth para bloqueios WAF.

O callback de honeytokens está disponível em `POST /api/v1/honeytokens/callback`; os eventos recentes podem ser consultados em `GET /api/v1/honeytokens/callbacks`.

Na Sprint 5 foram entregues o dashboard MVP responsivo com login/cadastro Supabase, navegação por Visão geral, Eventos, Superfície API e Configuração, polling near real-time, métricas, eventos, Shadow APIs e edição do upstream/modo/webhook. A API oferece `GET /api/v1/stats`, `GET /api/v1/logs` e `GET/PUT /api/v1/config` para a interface.

Na Sprint 8 foram entregues o barramento de eventos com publicação Upstash Redis e fallback local, correlação DurtWall-DurtScope e DurtGuardian-DurtScope, o `GET /api/v1/security/score` com score ponderado WAF/CSPM/ITDR e o relatório executivo em `GET /api/v1/security/report.pdf`. Snapshots ITDR podem ser enviados por `POST /api/v1/itdr/identities` e drifts por `POST /api/v1/cspm/drifts`.

O enrollment de agentes usa `POST /api/v1/agents/enrollment` com `{ "name": "durtwall-dev" }`. O token retornado deve ser guardado pelo operador e configurado como `DURTWALL_CONTROL_PLANE_TOKEN`, `DURTGUARDIAN_CONTROL_PLANE_TOKEN` ou `DURTSCOPE_CONTROL_PLANE_TOKEN`; ele é exibido apenas nessa resposta e armazenado no banco somente como hash.

Com `control_plane_url`/`control_plane_token` configurados, o DurtWall busca `GET /api/v1/agents/config` a cada 15s e aplica `upstream`/`mode` em tempo real, sem reiniciar. Cada busca autentica com o token do agente, o que atualiza `api_keys.last_used_at` e funciona como heartbeat. `GET /api/v1/agents` lista os agentes do tenant com esse `lastUsedAt`, e o dashboard usa isso para mostrar o status real de conexão (em vez de um rótulo fixo).

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

`bun run db:seed` cria a linha em `tenants` com o id de `DURTONE_TENANT_ID` (`00000000-0000-0000-0000-000000000001` por padrão) — sem isso, qualquer chamada que grave dado vinculado a esse tenant (ex. `POST /api/v1/agents/enrollment`) falha com violação de foreign key. É seguro rodar de novo a qualquer momento (idempotente).

Com isso feito, execute a API:

```powershell
cd apps/api
bun --env-file=.env.dev --watch src/index.ts
```

Smoke test básico:

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod -Method Post http://localhost:3000/api/v1/agents/enrollment -ContentType 'application/json' -Body '{"name":"durtwall-dev"}'
```

Use o token retornado no header `Authorization: Bearer <token>` para testar ingestão, configuração e scans. Em staging/produção, configure Supabase Auth, `DURTONE_AUTH_REQUIRED=true`, Redis e secrets manager; não use `.env.dev`.

Para testar revogação: guarde o campo `id` retornado no enrollment, execute `Invoke-RestMethod -Method Delete http://localhost:3000/api/v1/agents/enrollment/<id>` com o token de usuário/ambiente local e confirme que o token do agente passa a retornar `Invalid or revoked agent token`.

## Checks

```powershell
bun run --filter '*' check
cd apps/dashboard; bun run build
cd agents/durtwall; go vet ./...; go test ./...
```

O quality gate usa checks nativos por stack; PMD Java não se aplica ao monorepo Bun/Next.js/Go.

## MCP e deployments

O workspace possui MCPs para Vercel e Supabase em `.vscode/mcp.json`. O MCP da Vercel usa `VERCEL_TOKEN`; o MCP do Supabase exige um `SUPABASE_ACCESS_TOKEN` próprio, diferente da `SUPABASE_SERVICE_ROLE_KEY`.

O projeto Vercel usa `vercel.json` e o script `bun run vercel:deploy`. O deploy deve ser iniciado explicitamente após o projeto ser vinculado à conta correta.