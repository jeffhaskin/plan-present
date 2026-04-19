import fs from "fs";
import path from "path";
import os from "os";
import { RegistryEntry } from "../shared/types";
import { slugify } from "./slugify";

const VALID_EXTENSIONS = new Set([".md", ".markdown"]);
const PERSIST_DIR = path.join(os.homedir(), ".plan-present");
const PERSIST_PATH = path.join(PERSIST_DIR, "registry.json");

/** Primary index: slug → RegistryEntry */
const bySlug = new Map<string, RegistryEntry>();

/** Secondary index: absolutePath → slug (for O(1) dedup) */
const byPath = new Map<string, string>();

function persistToDisk(): void {
  try {
    if (!fs.existsSync(PERSIST_DIR)) {
      fs.mkdirSync(PERSIST_DIR, { recursive: true });
    }
    const entries = Array.from(bySlug.values());
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(entries, null, 2), "utf-8");
  } catch {
    // Best-effort persistence — don't crash on write failures
  }
}

export function loadFromDisk(): number {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return 0;
    const raw = fs.readFileSync(PERSIST_PATH, "utf-8");
    const entries: RegistryEntry[] = JSON.parse(raw);
    let loaded = 0;
    for (const entry of entries) {
      // Revalidate: file must still exist on disk
      try {
        fs.statSync(entry.absolutePath);
      } catch {
        continue; // File gone — discard entry
      }
      bySlug.set(entry.slug, entry);
      byPath.set(entry.absolutePath, entry.slug);
      loaded++;
    }
    // Persist the pruned list so stale entries are removed from disk
    if (loaded < entries.length) {
      persistToDisk();
    }
    return loaded;
  } catch {
    return 0;
  }
}

function resolveSlugCollision(base: string): string {
  if (!bySlug.has(base)) return base;
  let i = 1;
  while (bySlug.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function registerDocument(filePath: string): RegistryEntry {
  const abs = path.resolve(filePath);

  // Dedup: return existing if already registered
  const existingSlug = byPath.get(abs);
  if (existingSlug !== undefined) {
    return bySlug.get(existingSlug)!;
  }

  // Validate file exists and has valid extension
  const stat = fs.statSync(abs);
  const ext = path.extname(abs).toLowerCase();
  if (!VALID_EXTENSIONS.has(ext)) {
    throw new Error(`Not a markdown file: ${abs}`);
  }

  const baseSlug = slugify(abs);
  const slug = resolveSlugCollision(baseSlug);

  const entry: RegistryEntry = {
    slug,
    absolutePath: abs,
    originalBaseName: path.basename(abs),
    registeredAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString(),
    lastKnownMtimeMs: stat.mtimeMs,
    lastKnownSize: stat.size,
  };

  bySlug.set(slug, entry);
  byPath.set(abs, slug);
  persistToDisk();
  return entry;
}

export function getDocument(slug: string): RegistryEntry | undefined {
  return bySlug.get(slug);
}

export function getDocumentByPath(absPath: string): RegistryEntry | undefined {
  const slug = byPath.get(absPath);
  return slug !== undefined ? bySlug.get(slug) : undefined;
}

export function listDocuments(): RegistryEntry[] {
  return Array.from(bySlug.values());
}

export function setPinned(slug: string, pinned: boolean): RegistryEntry | undefined {
  const entry = bySlug.get(slug);
  if (!entry) return undefined;
  entry.pinned = pinned;
  if (!pinned) {
    delete entry.priorityPin;
  }
  persistToDisk();
  return entry;
}

export function setPriorityPin(
  slug: string,
  priority: number | null,
): { entry: RegistryEntry; affected: RegistryEntry[] } | undefined {
  const entry = bySlug.get(slug);
  if (!entry) return undefined;

  const affected: RegistryEntry[] = [];

  if (priority === null) {
    delete entry.priorityPin;
    persistToDisk();
    return { entry, affected };
  }

  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    throw new Error("priority must be null or an integer 1-5");
  }

  // Clear target's current priority so it doesn't participate in the shift below
  if (typeof entry.priorityPin === "number") {
    delete entry.priorityPin;
  }

  const bySlot = new Map<number, RegistryEntry>();
  for (const other of bySlug.values()) {
    if (other !== entry && typeof other.priorityPin === "number") {
      bySlot.set(other.priorityPin, other);
    }
  }

  // Find contiguous occupied run starting at `priority`
  let end = priority - 1;
  while (end + 1 <= 5 && bySlot.has(end + 1)) end++;

  // If the run extends through slot 5, overflow that holder to a regular pin
  if (end === 5) {
    const overflow = bySlot.get(5)!;
    delete overflow.priorityPin;
    affected.push(overflow);
    end = 4;
  }

  // Shift occupied slots [priority..end] down by one (end → end+1, ..., priority → priority+1)
  for (let k = end; k >= priority; k--) {
    const occupant = bySlot.get(k);
    if (!occupant) continue;
    occupant.priorityPin = k + 1;
    affected.push(occupant);
  }

  entry.priorityPin = priority;
  entry.pinned = true;
  persistToDisk();
  return { entry, affected };
}

export function removeDocument(slug: string): boolean {
  const entry = bySlug.get(slug);
  if (!entry) return false;
  bySlug.delete(slug);
  byPath.delete(entry.absolutePath);
  persistToDisk();
  return true;
}
