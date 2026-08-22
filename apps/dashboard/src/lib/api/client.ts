import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getActiveTenantId } from "@/lib/active-tenant";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  const userId = data.session?.user.id;
  const activeTenantId = userId ? getActiveTenantId(userId) : null;
  if (activeTenantId) headers["X-Tenant-ID"] = activeTenantId;
  return headers;
}

async function extractErrorMessage(response: Response, path: string): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // response wasn't JSON - fall through to the generic message below
  }
  return `Control Plane indisponível (${path})`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = { ...(await authHeaders()), ...(init.headers as Record<string, string> | undefined) };
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(await extractErrorMessage(response, path));
  return response.json() as Promise<T>;
}

export function apiGet<T>(path: string) {
  return request<T>(path);
}

export function apiPut<T>(path: string, body: unknown) {
  return request<T>(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function apiPost<T>(path: string, body?: unknown) {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function apiDelete<T>(path: string) {
  return request<T>(path, { method: "DELETE" });
}

export async function apiDownload(path: string): Promise<Blob> {
  const headers = await authHeaders();
  const response = await fetch(`${apiUrl}${path}`, { headers });
  if (!response.ok) throw new Error(`Não foi possível baixar ${path}`);
  return response.blob();
}
