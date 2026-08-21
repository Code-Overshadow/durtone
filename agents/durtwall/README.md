# DurtWall Agent

Agente Go do DurtOne. O processo recebe tráfego na porta configurada, inspeciona requisições com Coraza + OWASP CRS embutido, aplica rate limiting por IP e encaminha chamadas permitidas ao upstream.

```powershell
go run . -config config.yaml
```

Configuração mínima:

```yaml
upstream: http://localhost:3001
port: 8080
mode: block
rate_limit: 60
rate_burst: 20
```

Use `mode: monitor` para registrar detecções sem bloqueá-las. Regras adicionais podem ser colocadas em `rules.conf` usando SecLang. Logs estruturados são enviados para stdout por padrão; `log_file` pode apontar para um arquivo com permissões restritas.

## DurtShield

Analise os logs JSON emitidos pelo agente e compare os caminhos com um contrato OpenAPI:

```powershell
go run . -discover -logs durtwall.jsonl -openapi openapi.json -output endpoints.json
```

Cada endpoint retornado inclui método, caminho, frequência, status codes e os campos `documented`/`shadow`. Use `-webhook` para enviar alertas dos endpoints Shadow.

## Deception

Ative as capacidades da Sprint 4 no `config.yaml`:

```yaml
stealth: true
honeytokens: true
honeypot: true
honeypot_image: nginx:alpine
honeypot_port: 8081
```

Paths de varredura como `/admin`, `/backup`, `/.env`, `/.git`, `/wp-login` e `/phpmyadmin` são encaminhados para um container isolado via Docker SDK. O container aguarda readiness HTTP e é removido quando o agente encerra. Respostas JSON de endpoints permitidos recebem um campo `durtone_honeytoken`; respostas bloqueadas podem retornar `200` vazio quando `stealth` está ativo.

Para enviar logs ao Control Plane, configure `control_plane_url` e `control_plane_token` no YAML ou use `DURTWALL_CONTROL_PLANE_URL` e `DURTWALL_CONTROL_PLANE_TOKEN`. O agente mantém um buffer limitado e tenta reenviar falhas antes de descartar eventos quando a fila está cheia.