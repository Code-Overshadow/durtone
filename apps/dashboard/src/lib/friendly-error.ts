import type { Locale } from "@/lib/locale";

type Entry = { match: RegExp; pt: string; en: string };

// Generaliza o padrão que login-screen.tsx já usava só pro Supabase (formatAuthError) pra
// qualquer mensagem crua vinda da API ou de bibliotecas externas (AWS/Azure/GCP, Postgres,
// Supabase) - nunca mais mostra a exceção original pro usuário final.
const KNOWN_ERRORS: Entry[] = [
  { match: /over_email_send_rate_limit/i, pt: "O limite de envio de e-mails foi atingido. Aguarde um pouco antes de tentar de novo.", en: "The email send rate limit was reached. Please wait a moment before trying again." },
  { match: /invalid login credentials/i, pt: "E-mail ou senha incorretos.", en: "Incorrect email or password." },
  { match: /invalid or expired access token/i, pt: "Sua sessão expirou. Faça login novamente.", en: "Your session has expired. Please sign in again." },
  { match: /no_tenant_membership/i, pt: "Você ainda não faz parte de nenhum workspace.", en: "You don't belong to any workspace yet." },
  { match: /terms_not_accepted/i, pt: "É preciso aceitar os Termos de Uso e a Política de Privacidade.", en: "You must accept the Terms of Use and Privacy Policy." },
  { match: /invalid document number or legal name/i, pt: "CPF/CNPJ ou nome/razão social inválidos.", en: "Invalid document number or legal name." },
  { match: /the security token included in the request is invalid/i, pt: "As credenciais informadas não são válidas na AWS.", en: "The provided credentials are not valid in AWS." },
  { match: /token acquisition failed|token exchange failed/i, pt: "Não foi possível autenticar com as credenciais informadas.", en: "Could not authenticate with the provided credentials." },
  { match: /duplicate key value violates unique constraint/i, pt: "Esse registro já existe.", en: "This record already exists." },
  { match: /certificate (check|request) failed/i, pt: "Não foi possível verificar o certificado do domínio agora. Tente novamente em alguns minutos.", en: "Could not verify the domain certificate right now. Please try again in a few minutes." },
  { match: /credential encryption unavailable|credential_decryption_failed/i, pt: "O serviço de criptografia de credenciais está indisponível no momento.", en: "The credential encryption service is currently unavailable." },
  { match: /fetch failed|ECONNREFUSED|network/i, pt: "Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.", en: "Could not connect to the service. Please check your connection and try again." },
];

const GENERIC_FALLBACK: Record<Locale, string> = {
  pt: "Ocorreu um erro inesperado. Tente novamente em alguns instantes.",
  en: "An unexpected error occurred. Please try again shortly.",
};

export function friendlyError(rawMessage: string, locale: Locale): string {
  const entry = KNOWN_ERRORS.find(({ match }) => match.test(rawMessage));
  if (entry) return entry[locale];
  return GENERIC_FALLBACK[locale];
}
