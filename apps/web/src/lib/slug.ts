// DNS-safe slug for the per-agent Caddy path `/<slug>` (spec §1). Ported from
// zynd-deployer's slugify_name; the entityType suffix is dropped (Hermes has no
// agent/service split) — just name + a short random suffix so a user can
// recreate with the same name without waiting for slug recycling.

import { randomBytes } from "node:crypto";

const SLUG_MAX = 36;

export function slugify(name: string, fallbackSuffix = ""): string {
  let slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (slug.length < 3 && fallbackSuffix) {
    slug = `${slug}${fallbackSuffix}`;
  }
  if (slug.length > SLUG_MAX) {
    slug = slug.slice(0, SLUG_MAX);
  }
  return slug;
}

export function uniqueSlug(name: string): string {
  const base = slugify(name, "agent");
  const rand = randomBytes(3).toString("hex");
  const combined = `${base}-${rand}`;
  return combined.length > 50 ? combined.slice(0, 50) : combined;
}
