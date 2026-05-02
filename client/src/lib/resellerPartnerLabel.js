/**
 * Primary label for reseller partner rows: **Display name** when set, else login email, else id.
 *
 * @param {{
 *   reseller_partner_display_name?: string | null,
 *   reseller_partner_email?: string | null,
 *   reseller_partner_id?: string | number | null,
 * }} row
 * @returns {string}
 */
export function resellerPartnerLabel(row) {
  const d = String(row?.reseller_partner_display_name ?? "").trim();
  if (d) return d;
  const e = String(row?.reseller_partner_email ?? "").trim();
  if (e) return e;
  const id = row?.reseller_partner_id;
  if (id != null && String(id).trim() !== "") return `id ${id}`;
  return "—";
}

/**
 * `title` text: include email when the visible label is display name (or both for debugging).
 *
 * @param {{ reseller_partner_display_name?: string | null, reseller_partner_email?: string | null }} row
 * @returns {string}
 */
export function resellerPartnerTitle(row) {
  const d = String(row?.reseller_partner_display_name ?? "").trim();
  const e = String(row?.reseller_partner_email ?? "").trim();
  if (d && e) return `${d} · ${e}`;
  return d || e || "";
}
