function storageKey(userId: string) {
  return `durtone.activeTenant.${userId}`;
}

export function getActiveTenantId(userId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey(userId));
}

export function setActiveTenantId(userId: string, tenantId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), tenantId);
}

const COUNTRY_KEY = "durtone.activeCountry";

/** País do tenant ativo, cacheado localmente pra lib/api/client.ts poder escolher o locale das
 * mensagens de erro amigáveis sem precisar de contexto React (fica fora de qualquer componente). */
export function getActiveCountry(): string {
  if (typeof window === "undefined") return "BR";
  return window.localStorage.getItem(COUNTRY_KEY) ?? "BR";
}

export function setActiveCountry(country: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COUNTRY_KEY, country);
}
