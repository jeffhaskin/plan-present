export interface RegistryEntry {
  slug: string;
  absolutePath: string;
  originalBaseName: string;
  registeredAt: string;
  lastSavedAt: string;
  lastKnownMtimeMs: number;
  lastKnownSize: number;
  pinned?: boolean;
  priorityPin?: number;
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
  absolutePath: string;
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

export interface DocSummary {
  slug: string;
  fileName: string;
  absolutePath: string;
  url: string;
  pinned: boolean;
  priorityPin: number | null;
}

export interface TreeFolder {
  /** Path relative to the scan root. "" for the root folder itself. */
  relPath: string;
  /** Names (no path) of *.md files directly inside this folder, alphabetically sorted. */
  files: string[];
}

export interface TreeResponse {
  /** Absolute path of the scanned root directory. */
  rootPath: string;
  /** Folders with at least one .md file, in pre-order by path. Root folder first when applicable. */
  folders: TreeFolder[];
  /** True if the scan was capped (depth or file-count limit hit). */
  truncated: boolean;
}

export interface BrowseResponse {
  /** Resolved absolute path of the directory being browsed. */
  absolute: string;
  /** Absolute path of the parent directory, or null if at the filesystem root. */
  parent: string | null;
  /** Immediate subdirectory names (no path), alphabetically sorted, dotdirs excluded. */
  directories: string[];
}
