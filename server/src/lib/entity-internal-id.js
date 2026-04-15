import { prisma } from "./prisma.js";
import { ACTIVE } from "./active-row.js";

/**
 * Prisma `where` fragment `{ id: n }` from JWT `sub` or route param (digits only).
 *
 * @param {unknown} raw
 * @returns {{ id: number } | null}
 */
export function merchantWhereFromRouteParam(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return { id: n };
}

/**
 * @param {string} raw
 * @returns {{ id: number } | null}
 */
export function userWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * @param {string} raw
 * @returns {{ id: number } | null}
 */
export function walletWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * @param {string} raw
 * @returns {{ id: number } | null}
 */
export function transactionWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * @param {string} raw
 * @returns {{ id: number } | null}
 */
export function merchantSettlementWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * @param {string} raw
 * @returns {{ id: number } | null}
 */
export function scannerStateWhereFromRouteParam(raw) {
  return merchantWhereFromRouteParam(raw);
}

/**
 * Resolve merchant numeric PK from JWT `sub`, route param, or an existing number.
 *
 * @param {unknown} opaque
 * @returns {Promise<number | null>}
 */
export async function resolveMerchantInternalId(opaque) {
  if (typeof opaque === "number" && Number.isInteger(opaque) && opaque >= 1) {
    const row = await prisma.merchant.findFirst({
      where: { id: opaque, ...ACTIVE },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const w = merchantWhereFromRouteParam(opaque);
  if (!w) return null;
  const row = await prisma.merchant.findFirst({
    where: { ...w, ...ACTIVE },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * @param {unknown} opaque
 * @returns {Promise<number | null>}
 */
export async function resolveAdminInternalId(opaque) {
  if (typeof opaque === "number" && Number.isInteger(opaque) && opaque >= 1) {
    const row = await prisma.admin.findFirst({
      where: { id: opaque, ...ACTIVE },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const w = merchantWhereFromRouteParam(opaque);
  if (!w) return null;
  const row = await prisma.admin.findFirst({
    where: { ...w, ...ACTIVE },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Gateway / portal: end-user id is the integer `users.id` (string or number in JSON).
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
  const w = userWhereFromRouteParam(String(rawUserId ?? ""));
  if (!w) return null;
  const row = await prisma.user.findFirst({
    where: {
      ...w,
      merchantId: merchantInternalId,
      environment,
      ...ACTIVE,
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * @param {string} rawWalletId
 */
export async function resolveWalletInternalId(rawWalletId) {
  const w = walletWhereFromRouteParam(String(rawWalletId ?? ""));
  if (!w) return null;
  const row = await prisma.wallet.findFirst({
    where: { ...w, ...ACTIVE },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * @param {unknown} txOpaque
 */
export async function resolveTransactionInternalId(txOpaque) {
  if (
    typeof txOpaque === "number" &&
    Number.isInteger(txOpaque) &&
    txOpaque >= 1
  ) {
    const row = await prisma.transaction.findFirst({
      where: { id: txOpaque, ...ACTIVE },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  const w = transactionWhereFromRouteParam(String(txOpaque ?? ""));
  if (!w) return null;
  const row = await prisma.transaction.findFirst({
    where: { ...w, ...ACTIVE },
    select: { id: true },
  });
  return row?.id ?? null;
}
