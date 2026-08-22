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
