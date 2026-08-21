# DurtWall Edge Proxy

Serviço Go do Control Plane DurtOne - **não é mais instalado pelo cliente**. Roda na infra do
DurtOne (Fly.io) como um fleet compartilhado por todos os tenants: o cliente aponta um CNAME do
próprio domínio para esse fleet, e cada requisição é roteada pelo `Host` header até o tenant certo.

O processo recebe tráfego HTTP puro (o Fly Proxy termina TLS na borda usando os certificados
emitidos via `apps/api/src/flyCerts.ts` - ver Fase 5/8 do plano), resolve o tenant pelo `Host`,
inspeciona a requisição com Coraza + OWASP CRS embutido (uma engine compartilhada para todos os
tenants nesta fase - regras customizadas por tenant ainda não existem), aplica rate limiting por IP
e encaminha ao upstream daquele tenant.

```powershell
go run . -config config.yaml
```

Configuração mínima (`config.yaml`):

```yaml
port: 8080
rate_limit: 60
rate_burst: 20
control_plane_url: "https://api.durtone.io"
fleet_token: "segredo-compartilhado-com-o-control-plane"
```

Sem `control_plane_url`/`fleet_token`, o processo sobe com uma tabela de roteamento vazia - toda
requisição recebe 404 "domain not configured" até a primeira sincronização bem-sucedida.

## Tabela de roteamento

Em vez de um `upstream`/`mode` fixos no YAML, o processo faz poll de
`GET {control_plane_url}/api/v1/edge/routing-table` a cada 15s, autenticado com `fleet_token`
(o mesmo valor configurado como `EDGE_FLEET_TOKEN` na API - ver `apps/api/.env.example`). A resposta
lista todos os domínios `active` e o config mais recente do tenant de cada um
(`{hostname, tenantId, upstream, mode, alertWebhookUrl, settings}`); a tabela inteira é substituída
a cada poll (`routing.go`). `settings.stealth`/`settings.honeytokens` (booleanos, opcionais) ativam
essas features por tenant.

Envio de logs (`shipLoop`, `logger.go`) usa o mesmo `fleet_token`, e cada evento carrega o
`tenantId` resolvido no momento da requisição - `POST /api/v1/ingest/logs` também tem um caminho de
autenticação por fleet que persiste cada entrada no tenant certo em vez de assumir um único tenant
por token, como funcionava antes.

## DurtShield

Analise os logs JSON emitidos pelo agente e compare os caminhos com um contrato OpenAPI:

```powershell
go run . -discover -logs durtwall.jsonl -openapi openapi.json -output endpoints.json
```

Cada endpoint retornado inclui método, caminho, frequência, status codes e os campos `documented`/`shadow`. Use `-webhook` para enviar alertas dos endpoints Shadow. Esse modo é standalone (roda contra um arquivo local) e não passa pela tabela de roteamento.

## Deception

Scanners (`isScanner`, `deception.go` - paths como `/admin`, `/backup`, `/.env`, `/.git`,
`/wp-login`, `/phpmyadmin`, `/etc/passwd`) são desviados para um `honeypotStrategy`
(`honeypot.go`) em vez de chegar no upstream real. Duas implementações:

- **`syntheticHoneypot` (padrão, sempre ativo, roda no fleet gerenciado)**: fabrica a resposta no
  próprio processo, sem container/VM. Usa os endpoints que o DurtShield já descobriu daquele
  tenant (`tenantRoute.knownEndpoints`, vindo de `endpoints` via a tabela de roteamento) pra
  responder com o método/formato que um scanner esperaria da API real daquele tenant - por
  exemplo, um scan em `/admin/users/999999` é respondido no formato de um `/admin/users/{id}`
  documentado de verdade, se o tenant tiver um. Injeta o mesmo honeytoken (`injectHoneytoken`) que
  respostas reais usam, então uma credencial "roubada" do honeypot é rastreável igual a uma
  vazada de verdade.
- **`dockerHoneypotManager` (`honeypot: true` no `config.yaml`, standalone/local apenas)**: sobe
  um container real via Docker SDK e faz proxy pra ele - decoy mais convincente porque é um
  ambiente de fato, mas exige daemon Docker local, que não existe numa Fly Machine compartilhada
  entre tenants. Mantido funcional (`deception_test.go`) só pra esse cenário.

As duas implementam a mesma interface `honeypotStrategy`, então uma futura estratégia baseada na
**Fly Machines API** (uma VM efêmera de verdade por tenant, isolamento real, viável no fleet
compartilhado onde Docker não é) entra no lugar sem precisar tocar em `ServeHTTP` - é o
complemento natural para quando o decoy sintético não bastar (ex. um atacante que tenta manter
sessão/navegar, não só bater um request isolado). Fica como próximo passo, não como bloqueio.

`stealth` e `honeytokens` (JSON `durtone_honeytoken` injetado em respostas de endpoints permitidos,
fora do fluxo de honeypot) já são por tenant, lidos de `settings` na tabela de roteamento - ver
seção acima.
