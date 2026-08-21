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

`honeypot`/`honeypot_image`/`honeypot_port` continuam existindo no `config.yaml`, mas **honeypot
dinâmico não é suportado no fleet gerenciado por agora** - ele depende de um daemon Docker local
(`deception.go`, via Docker SDK) que não existe nas Fly Machines compartilhadas entre tenants.
Adaptar isso pra Fly Machines API (VM efêmera em vez de container) é backlog. O código continua
funcional e testado em modo standalone/local.

`stealth` e `honeytokens` (JSON `durtone_honeytoken` injetado em respostas de endpoints permitidos)
já são por tenant, lidos de `settings` na tabela de roteamento - ver seção acima.
