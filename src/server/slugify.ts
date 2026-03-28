import path from "path";

/**
 * Generate a URL-safe slug from a markdown file path.
 *
 * Algorithm:
 * 1. Extract basename without .md / .markdown extension
 * 2. Lowercase
 * 3. Replace any char not in [a-z0-9_-] with underscore
 * 4. Collapse consecutive underscores to one
 * 5. Trim leading/trailing underscores
 * 6. If empty after sanitization, use "doc"
 */
export function slugify(filePath: string): string {
  const base = path.basename(filePath);
  const stripped = base.endsWith(".markdown")
    ? base.slice(0, -9)
    : base.endsWith(".md")
      ? base.slice(0, -3)
      : base;
  let slug = stripped.toLowerCase();

  slug = slug.replace(/[^a-z0-9_-]/g, "_");
  slug = slug.replace(/_+/g, "_");
  slug = slug.replace(/^_+|_+$/g, "");

  return slug || "doc";
}
