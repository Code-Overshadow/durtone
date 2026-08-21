# DurtScope

Agente Bun de inventario e risk scoring de identidades para o DurtOne.

## Providers configuraveis

Defina `DURTSCOPE_PROVIDER` como `keycloak`, `okta`, `aws`, `google` ou `none`.

### Keycloak

```env
DURTSCOPE_PROVIDER=keycloak
DURTSCOPE_BASE_URL=https://keycloak.example.com
DURTSCOPE_REALM=master
DURTSCOPE_CLIENT_ID=durtone-scope
DURTSCOPE_CLIENT_SECRET=secret-from-a-secret-manager
```

O agente usa Client Credentials e consulta `/admin/realms/{realm}/users`.

### Okta

```env
DURTSCOPE_PROVIDER=okta
DURTSCOPE_BASE_URL=https://company.okta.com
DURTSCOPE_API_TOKEN=secret-from-a-secret-manager
```

O agente consulta `/api/v1/users` usando o token `SSWS`.

### AWS IAM

```env
DURTSCOPE_PROVIDER=aws
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=access-key
AWS_SECRET_ACCESS_KEY=secret-key
AWS_SESSION_TOKEN=optional-session-token
```

O agente usa `@aws-sdk/client-iam` e lista IAM users, access keys e roles. Em producao, prefira role de workload ou credential chain do ambiente em vez de chaves estaticas.

### Google Workspace

```env
DURTSCOPE_PROVIDER=google
DURTSCOPE_CUSTOMER=my_customer
DURTSCOPE_ACCESS_TOKEN=oauth-token-from-secret-manager
# Opcional: sobrescreve a URL padrao da Admin SDK
DURTSCOPE_BASE_URL=https://admin.googleapis.com/admin/directory/v1
```

O token precisa ter escopo suficiente para `admin.directory.user.readonly`.

## Execucao

```bash
bun run --cwd apps/durtscope dev
```

O dashboard permite selecionar o provider e editar os parametros em Configuracao. Secrets sao mascarados pelo Control Plane e nao sao devolvidos em respostas de leitura.
