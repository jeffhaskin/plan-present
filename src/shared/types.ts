export interface RegistryEntry {
  slug: string;
  absolutePath: string;
  originalBaseName: string;
  registeredAt: string;
  lastSavedAt: string;
  lastKnownMtimeMs: number;
  lastKnownSize: number;
}

export interface OpenRequest {
  path: string;
}

export interface OpenResponse {
  url: string;
  slug: string;
}

export interface DocResponse {
  content: string;
  mtime: number;
  slug: string;
  fileName: string;
}

export interface SaveRequest {
  content: string;
  baseMtime: number;
}

export interface SaveResponse {
  saved: boolean;
  conflict: boolean;
  mtime: number;
  conflictPath?: string;
  recreated?: boolean;
}

export interface HealthResponse {
  ok: boolean;
  tailscaleHost: string;
  docCount: number;
  uptime: number;
}
