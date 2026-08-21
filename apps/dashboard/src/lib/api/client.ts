import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = { ...(await authHeaders()), ...(init.headers as Record<string, string> | undefined) };
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`Control Plane indisponível (${path})`);
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
