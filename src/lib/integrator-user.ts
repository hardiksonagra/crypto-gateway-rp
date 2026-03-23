/**
 * Stable internal email for (merchant, external_user_id) pairs.
 * Stored in users.email (unique) so we can upsert without a schema migration.
 * Production: add API keys + merchant table; this is the minimal integration shape.
 */
export function integratorIdentityEmail(merchantRef: string, externalUserId: string): string {
  const m = merchantRef.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const u = externalUserId.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  if (!m || !u) throw new Error("INVALID_MERCHANT_OR_USER_REF");
  return `gw.${m}.${u}@integrator.internal`;
}
