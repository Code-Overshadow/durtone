# DurtScope

Worker de inventário e risk scoring de identidades (ITDR) do DurtOne. Assim como o DurtGuardian
(CSPM), roda na sua infra, não na do cliente: consulta `identity_providers` de todos os tenants
direto no Postgres, decifra a credencial de cada um (`@durtone/crypto`), coleta identidades do
provider (`@durtone/identity-providers`) e grava em `identities`. O cliente cadastra o provider
pelo dashboard — não instala nada.

## Providers suportados

Cada linha em `identity_providers` tem um `kind`: `keycloak`, `okta`, `aws` ou `google`. O campo
`credential_ref` guarda, criptografado, um JSON com os segredos específicos do provider:

| kind | campos no `credential_ref` decifrado | campos não-secretos (colunas próprias) |
|---|---|---|
| `keycloak` | `{ "clientSecret": "..." }` | `baseUrl`, `realmOrTenant` (realm), `clientId` |
| `okta` | `{ "apiToken": "..." }` | `baseUrl` |
| `aws` | `{ "accessKeyId": "...", "secretAccessKey": "...", "sessionToken": "..." }` (sessionToken opcional) | `region` |
| `google` | `{ "accessToken": "..." }` | `baseUrl` (opcional), `realmOrTenant` (customer id) |

Para Keycloak, o worker também busca as sessões ativas de cada usuário
(`/admin/realms/{realm}/users/{id}/sessions`) para preencher `ipAddresses` — necessário para a
correlação com o DurtWall (IP de ataque → identidade). Os outros providers não expõem IP de
sessão nas APIs usadas hoje, então ficam com `ipAddresses: []`.

## Revogação

A revogação (desativar usuário, matar sessão, deletar access key) é uma ação disparada pelo
usuário no dashboard, não algo que este worker faz por conta própria. Ela é executada pela API
(`POST /api/v1/identities/:id/revoke`), que também usa `@durtone/identity-providers` para chamar
o provider certo, e sempre grava em `audit_logs`.

## Execução

```bash
bun run --cwd apps/durtscope dev
```

Requer `DATABASE_URL` e `CREDENTIAL_ENCRYPTION_KEY` (mesma chave da API) — ver `.env.example`.
