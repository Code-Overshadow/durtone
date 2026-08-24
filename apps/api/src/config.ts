import { z } from 'zod';

export const configSchema = z.object({
  upstream: z.string().url(),
  mode: z.enum(['block', 'monitor']),
  alertWebhookUrl: z.string().url().or(z.literal('')).optional(),
});

export type WafConfig = z.infer<typeof configSchema>;

// Estado vazio de verdade - nao um singleton compartilhado. Cada tenant tem seu proprio config
// persistido em `configs`; isso e' so o valor mostrado antes do primeiro `PUT` daquele tenant.
export const DEFAULT_WAF_CONFIG: WafConfig = {
  upstream: '',
  mode: 'monitor',
  alertWebhookUrl: '',
};
