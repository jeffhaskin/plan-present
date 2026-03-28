import fs from "fs";
import path from "path";
import { RegistryEntry } from "../shared/types";
import { slugify } from "./slugify";

const VALID_EXTENSIONS = new Set([".md", ".markdown"]);

/** Primary index: slug → RegistryEntry */
const bySlug = new Map<string, RegistryEntry>();

/** Secondary index: absolutePath → slug (for O(1) dedup) */
const byPath = new Map<string, string>();

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

export function removeDocument(slug: string): boolean {
  const entry = bySlug.get(slug);
  if (!entry) return false;
  bySlug.delete(slug);
  byPath.delete(entry.absolutePath);
  return true;
}
