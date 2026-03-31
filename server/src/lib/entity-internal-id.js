import { prisma } from "./prisma.js";

/**
 * Resolve a merchant row’s numeric PK from JWT `sub`, route param (numeric or legacy `public_id`), or an existing number.
 *
 * @param {unknown} opaque
 * @returns {Promise<number | null>}
 */
export async function resolveMerchantInternalId(opaque) {
  if (typeof opaque === "number" && Number.isInteger(opaque)) {
    const row = await prisma.merchant.findUnique({
      where: { id: opaque },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const s = String(opaque ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const row = await prisma.merchant.findUnique({
      where: { id: n },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const row = await prisma.merchant.findUnique({
    where: { publicId: s },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * @param {unknown} opaque
 * @returns {Promise<number | null>}
 */
export async function resolveAdminInternalId(opaque) {
  if (typeof opaque === "number" && Number.isInteger(opaque)) {
    const row = await prisma.admin.findUnique({
      where: { id: opaque },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const s = String(opaque ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const row = await prisma.admin.findUnique({
      where: { id: n },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const row = await prisma.admin.findUnique({
    where: { publicId: s },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Prisma `where` for a merchant looked up by admin route param (numeric id or `public_id`).
 *
 * @param {string} raw
 * @returns {{ OR: Array<{ id: number } | { publicId: string }> } | null}
 */
export function merchantWhereFromRouteParam(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const or = /** @type {Array<{ id: number } | { publicId: string }>} */ ([
    { publicId: s },
  ]);
  if (/^\d+$/.test(s)) {
    or.unshift({ id: parseInt(s, 10) });
  }
  return { OR: or };
}

/**
 * @param {string} raw
 * @returns {{ OR: Array<{ id: number } | { publicId: string }> } | null}
 */
export function userWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * @param {string} raw
 * @returns {{ OR: Array<{ id: number } | { publicId: string }> } | null}
 */
export function walletWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * @param {string} raw
 * @returns {{ OR: Array<{ id: number } | { publicId: string }> } | null}
 */
export function transactionWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * @param {string} raw
 * @returns {{ OR: Array<{ id: number } | { publicId: string }> } | null}
 */
export function merchantSettlementWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * @param {string} raw
 * @returns {{ OR: Array<{ id: number } | { publicId: string }> } | null}
 */
export function scannerStateWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * End-user row: gateway sends legacy `public_id` or numeric id string.
 *
 * @param {string} rawUserId
 * @param {number} merchantInternalId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 */
export async function resolveUserScopedInternalId(
  rawUserId,
  merchantInternalId,
  environment,
) {
  const s = String(rawUserId ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const row = await prisma.user.findFirst({
      where: { id: n, merchantId: merchantInternalId, environment },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const row = await prisma.user.findFirst({
    where: {
      publicId: s,
      merchantId: merchantInternalId,
      environment,
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Wallet by client-provided id (numeric or `public_id`).
 *
 * @param {string} rawWalletId
 */
export async function resolveWalletInternalId(rawWalletId) {
  const s = String(rawWalletId ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const row = await prisma.wallet.findUnique({
      where: { id: n },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const row = await prisma.wallet.findUnique({
    where: { publicId: s },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * @param {unknown} txOpaque
 */
export async function resolveTransactionInternalId(txOpaque) {
  if (typeof txOpaque === "number" && Number.isInteger(txOpaque)) {
    const row = await prisma.transaction.findUnique({
      where: { id: txOpaque },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const s = String(txOpaque ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const row = await prisma.transaction.findUnique({
      where: { id: n },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const row = await prisma.transaction.findUnique({
    where: { publicId: s },
    select: { id: true },
  });
  return row?.id ?? null;
}
