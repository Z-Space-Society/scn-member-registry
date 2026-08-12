/**
 * The tier vocabulary. SCN owns these slugs — they are not read from any
 * gateway, which is the point: the registry decides what a tier is, and the
 * systems that enforce entitlements map from the slug.
 *
 * Slugs rather than integers because `level-0` is the free tier and the most
 * common one, and `0` is falsy in JavaScript — the natural `if (grant.tier)`
 * guard would silently drop exactly the members it matters most for.
 *
 * This string is what an Open WebUI group must be *named*, since that match is
 * by name. A human-friendly display layer maps from the slug; it never
 * replaces it.
 */
export const TIERS = [
  "level-0",
  "level-1",
  "level-2",
  "level-3",
  "level-4",
  "level-5",
  "level-6",
  "level-7",
  "level-8",
  "level-9",
] as const;

export type Tier = (typeof TIERS)[number];

export const DEFAULT_TIER: Tier = "level-0";

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}
