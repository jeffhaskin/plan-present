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

    // Migration: every pinned entry must have a priorityPin slot.
    const taken = new Set<number>();
    for (const entry of bySlug.values()) {
      if (typeof entry.priorityPin === "number") taken.add(entry.priorityPin);
    }
    let migrated = false;
    for (const entry of bySlug.values()) {
      if (entry.pinned && typeof entry.priorityPin !== "number") {
        let slot = 1;
        while (taken.has(slot)) slot++;
        entry.priorityPin = slot;
        taken.add(slot);
        migrated = true;
      }
    }

    // Persist the pruned list so stale entries are removed from disk
    if (loaded < entries.length || migrated) {
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

export function setPinned(
  slug: string,
  pinned: boolean,
): { entry: RegistryEntry; affected: RegistryEntry[] } | undefined {
  const entry = bySlug.get(slug);
  if (!entry) return undefined;

  const affected: RegistryEntry[] = [];

  if (pinned) {
    entry.pinned = true;
    if (typeof entry.priorityPin !== "number") {
      const taken = new Set<number>();
      for (const other of bySlug.values()) {
        if (typeof other.priorityPin === "number") taken.add(other.priorityPin);
      }
      let slot = 1;
      while (taken.has(slot)) slot++;
      entry.priorityPin = slot;
    }
    persistToDisk();
    return { entry, affected };
  }

  const cleared = typeof entry.priorityPin === "number" ? entry.priorityPin : null;
  entry.pinned = false;
  delete entry.priorityPin;

  if (cleared !== null) {
    for (const other of bySlug.values()) {
      if (other === entry) continue;
      if (typeof other.priorityPin === "number" && other.priorityPin > cleared) {
        other.priorityPin = other.priorityPin - 1;
        affected.push(other);
      }
    }
  }

  persistToDisk();
  return { entry, affected };
}

export function movePriority(
  slug: string,
  direction: "up" | "down" | "top" | "bottom",
): { entry: RegistryEntry; affected: RegistryEntry[] } | undefined {
  const entry = bySlug.get(slug);
  if (!entry) return undefined;

  // Auto-pin on top/bottom for an unpinned entry: one-click "pin & place at end".
  // setPinned appends at the next free slot; the shift logic below then moves
  // it to the requested end. up/down still require an already-pinned entry.
  if (
    (direction === "top" || direction === "bottom") &&
    typeof entry.priorityPin !== "number"
  ) {
    const pinRes = setPinned(slug, true);
    if (!pinRes) return undefined;
  }

  if (typeof entry.priorityPin !== "number") return undefined;
  const current = entry.priorityPin;

  if (direction === "up" || direction === "down") {
    let neighbor: RegistryEntry | null = null;
    if (direction === "up") {
      let best = 0;
      for (const other of bySlug.values()) {
        if (other === entry) continue;
        if (typeof other.priorityPin === "number" && other.priorityPin < current && other.priorityPin > best) {
          best = other.priorityPin;
          neighbor = other;
        }
      }
    } else {
      let best = Infinity;
      for (const other of bySlug.values()) {
        if (other === entry) continue;
        if (typeof other.priorityPin === "number" && other.priorityPin > current && other.priorityPin < best) {
          best = other.priorityPin;
          neighbor = other;
        }
      }
    }

    if (neighbor === null) {
      return { entry, affected: [] };
    }

    const neighborSlot = neighbor.priorityPin!;
    neighbor.priorityPin = current;
    entry.priorityPin = neighborSlot;
    persistToDisk();
    return { entry, affected: [neighbor] };
  }

  let minP = Infinity;
  let maxP = 0;
  for (const other of bySlug.values()) {
    if (typeof other.priorityPin !== "number") continue;
    if (other.priorityPin < minP) minP = other.priorityPin;
    if (other.priorityPin > maxP) maxP = other.priorityPin;
  }

  const affected: RegistryEntry[] = [];
  if (direction === "top") {
    if (current === minP) return { entry, affected: [] };
    for (const other of bySlug.values()) {
      if (other === entry) continue;
      if (typeof other.priorityPin !== "number") continue;
      if (other.priorityPin < current) {
        other.priorityPin += 1;
        affected.push(other);
      }
    }
    entry.priorityPin = minP;
  } else {
    if (current === maxP) return { entry, affected: [] };
    for (const other of bySlug.values()) {
      if (other === entry) continue;
      if (typeof other.priorityPin !== "number") continue;
      if (other.priorityPin > current) {
        other.priorityPin -= 1;
        affected.push(other);
      }
    }
    entry.priorityPin = maxP;
  }

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
