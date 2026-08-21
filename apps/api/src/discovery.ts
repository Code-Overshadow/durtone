import { z } from 'zod';

const logSchema = z.object({
  method: z.string().min(1).max(16),
  path: z.string().min(1).max(2048),
  status: z.number().int().min(100).max(599),
});

const logsPayloadSchema = z.union([z.array(logSchema), z.object({ logs: z.array(logSchema) })]);

export type DiscoveredEndpoint = {
  method: string;
  path: string;
  count: number;
  statusCodes: Record<string, number>;
  documented: boolean;
  shadow: boolean;
};

export type RequestLog = {
  id: string;
  method: string;
  path: string;
  status: number;
  remoteIp: string;
  blocked: boolean;
  reason: string;
  timestamp: string;
};

type DocumentedPaths = Map<string, string[]>;

const endpointStore = new Map<string, DiscoveredEndpoint>();
const documentedPaths: DocumentedPaths = new Map();
const requestLogs: RequestLog[] = [];

export function ingestLogs(payload: unknown) {
  const parsed = logsPayloadSchema.parse(payload);
  const logs = Array.isArray(parsed) ? parsed : parsed.logs;
  for (const log of logs) {
    const method = log.method.toUpperCase();
    const requestPath = normalizePath(log.path);
    const key = `${method} ${requestPath}`;
    const current = endpointStore.get(key) ?? {
      method,
      path: requestPath,
      count: 0,
      statusCodes: {},
      documented: isDocumented(method, requestPath),
      shadow: !isDocumented(method, requestPath),
    };
    current.count += 1;
    current.statusCodes[String(log.status)] = (current.statusCodes[String(log.status)] ?? 0) + 1;
    endpointStore.set(key, current);
    requestLogs.push({
      id: crypto.randomUUID(),
      method,
      path: requestPath,
      status: log.status,
      remoteIp: 'unknown',
      blocked: log.status === 403,
      reason: log.status === 403 ? 'waf' : '',
      timestamp: new Date().toISOString(),
    });
  }
  while (requestLogs.length > 1000) requestLogs.shift();
  return logs.length;
}

export function replaceOpenApi(document: unknown) {
  const paths = z.object({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) }).parse(document).paths;
  documentedPaths.clear();
  for (const [route, operations] of Object.entries(paths)) {
    for (const method of Object.keys(operations)) {
      const normalizedMethod = method.toUpperCase();
      if (normalizedMethod === 'PARAMETERS') continue;
      const routes = documentedPaths.get(normalizedMethod) ?? [];
      routes.push(route);
      documentedPaths.set(normalizedMethod, routes);
    }
  }
  for (const endpoint of endpointStore.values()) {
    endpoint.documented = isDocumented(endpoint.method, endpoint.path);
    endpoint.shadow = !endpoint.documented;
  }
  return documentedPaths.size;
}

export function listEndpoints() {
  return [...endpointStore.values()].sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
}

function normalizePath(value: string) {
  try {
    return new URL(value, 'http://durtone.local').pathname;
  } catch {
    return value.split('?')[0] || '/';
  }
}

function isDocumented(method: string, requestPath: string) {
  return (documentedPaths.get(method) ?? []).some((route) => openApiPathMatches(route, requestPath));
}

function openApiPathMatches(route: string, requestPath: string) {
  const routeParts = route.split('/').filter(Boolean);
  const requestParts = requestPath.split('/').filter(Boolean);
  return routeParts.length === requestParts.length && routeParts.every((part, index) => (part.startsWith('{') && part.endsWith('}')) || part === requestParts[index]);
}

export function listRequestLogs() {
  return [...requestLogs].reverse();
}

export function getDiscoveryStats() {
  return {
    totalRequests: requestLogs.length,
    blockedRequests: requestLogs.filter((log) => log.blocked).length,
    discoveredEndpoints: endpointStore.size,
    shadowApis: [...endpointStore.values()].filter((endpoint) => endpoint.shadow).length,
  };
}