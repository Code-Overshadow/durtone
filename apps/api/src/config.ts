import { z } from 'zod';

const configSchema = z.object({
  upstream: z.string().url(),
  mode: z.enum(['block', 'monitor']),
  alertWebhookUrl: z.string().url().or(z.literal('')).optional(),
});

type WafConfig = z.infer<typeof configSchema>;

let currentConfig: WafConfig = {
  upstream: 'http://localhost:3001',
  mode: 'block',
  alertWebhookUrl: '',
};

export function getWafConfig() {
  return { ...currentConfig };
}

export function updateWafConfig(payload: unknown) {
  currentConfig = configSchema.parse(payload);
  return getWafConfig();
}

export function mergePersistedConfig(config: Partial<WafConfig>) {
  currentConfig = {
    ...currentConfig,
    ...config,
  };
  return getWafConfig();
}
