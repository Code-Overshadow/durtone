import { createBrowserClient } from '@supabase/ssr';

// Sem isso, uma requisição do Supabase Auth que trava (rede instável, cold start do projeto) nunca
// resolve nem rejeita - o botão de login fica desabilitado em "Aguarde..." pra sempre, sem deixar
// o usuário tentar de novo. AbortSignal.timeout aborta a requisição de verdade (não só ignora a
// resposta), então o fetch rejeita e o `finally` do formulário sempre reabilita o botão.
const AUTH_REQUEST_TIMEOUT_MS = 15_000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS) });
}

export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required');
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: fetchWithTimeout },
  });
}