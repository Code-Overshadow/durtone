export const wafModes = ['block', 'monitor'] as const;

export type WafMode = (typeof wafModes)[number];

export interface WafConfigInput {
  upstream: string;
  port: number;
  mode: WafMode;
  customRules?: string | null;
  alertWebhookUrl?: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}