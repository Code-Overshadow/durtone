import { z } from 'zod';

const configSchema = z.object({
  upstream: z.string().url(),
  mode: z.enum(['block', 'monitor']),
  alertWebhookUrl: z.string().url().or(z.literal('')).optional(),
  identityProvider: z.enum(['none', 'keycloak', 'okta', 'aws', 'google']).default('none'),
  identityBaseUrl: z.string().url().or(z.literal('')).optional(),
  identityRealm: z.string().max(160).optional(),
  identityTenant: z.string().max(160).optional(),
  identityRegion: z.string().max(64).optional(),
  identityClientId: z.string().max(320).optional(),
  identityClientSecret: z.string().max(2048).optional(),
  identityAccessToken: z.string().max(4096).optional(),
});

type WafConfig = z.infer<typeof configSchema>;

let currentConfig: WafConfig = {
  upstream: 'http://localhost:3001',
  mode: 'block',
  alertWebhookUrl: '',
  identityProvider: 'none',
  identityBaseUrl: '',
  identityRealm: '',
  identityTenant: '',
  identityRegion: 'us-east-1',
  identityClientId: '',
  identityClientSecret: '',
  identityAccessToken: '',
};

export function getWafConfig(maskSecrets = true) {
  if (!maskSecrets) return { ...currentConfig };
  return {
    ...currentConfig,
    identityClientSecret: currentConfig.identityClientSecret ? '********' : '',
    identityAccessToken: currentConfig.identityAccessToken ? '********' : '',
  };
}

export function updateWafConfig(payload: unknown) {
  const parsed = configSchema.parse(payload);
  currentConfig = {
    ...parsed,
    identityClientSecret: parsed.identityClientSecret === '********' ? currentConfig.identityClientSecret : parsed.identityClientSecret,
    identityAccessToken: parsed.identityAccessToken === '********' ? currentConfig.identityAccessToken : parsed.identityAccessToken,
  };
  return getWafConfig();
}

export function mergePersistedConfig(config: Partial<WafConfig>) {
  currentConfig = {
    ...currentConfig,
    ...config,
  };
  return getWafConfig();
}