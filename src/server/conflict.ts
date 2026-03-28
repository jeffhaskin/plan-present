import fs from "fs";
import path from "path";

/**
 * Generate a conflict path for a file. Given '/path/to/plan.md', tries
 * 'plan_conflict.md', then 'plan_conflict_1.md', 'plan_conflict_2.md', etc.
 * Returns the first path that doesn't already exist on disk.
 */
export function generateConflictPath(originalPath: string): string {
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const base = path.basename(originalPath, ext);

  const first = path.join(dir, `${base}_conflict${ext}`);
  if (!fs.existsSync(first)) return first;

  for (let i = 1; ; i++) {
    const candidate = path.join(dir, `${base}_conflict_${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

/**
 * Write content atomically by writing to a .tmp file then renaming.
 * Atomic on the same filesystem.
 */
export function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export interface SaveResult {
  saved: boolean;
  conflict: boolean;
  conflictPath?: string;
  mtime: number;
  recreated?: boolean;
}

/**
 * Save content to a file with mtime-based conflict detection.
 *
 * - If file exists and mtime matches expectedMtimeMs: write normally (atomic).
 * - If file exists and mtime differs: rename existing to conflict path, then write.
 * - If file was deleted: recreate it.
 */
export function saveWithConflictDetection(
  filePath: string,
  content: string,
  expectedMtimeMs: number,
): SaveResult {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // File doesn't exist — recreate
    atomicWrite(filePath, content);
    const newStat = fs.statSync(filePath);
    return {
      saved: true,
      conflict: false,
      mtime: newStat.mtimeMs,
      recreated: true,
    };
  }

  if (stat.mtimeMs === expectedMtimeMs) {
    // No conflict — write directly
    atomicWrite(filePath, content);
    const newStat = fs.statSync(filePath);
    return { saved: true, conflict: false, mtime: newStat.mtimeMs };
  }

  // Conflict: mtime mismatch — save existing content aside
  const conflictPath = generateConflictPath(filePath);
  fs.renameSync(filePath, conflictPath);
  atomicWrite(filePath, content);
  const newStat = fs.statSync(filePath);
  return {
    saved: true,
    conflict: true,
    conflictPath,
    mtime: newStat.mtimeMs,
  };
}
