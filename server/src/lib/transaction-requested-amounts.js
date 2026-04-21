import { prisma } from "./prisma.js";
import { ACTIVE } from "./active-row.js";
import { formatAtomicAmountString } from "./format-atomic-amount.js";

/**
 * Load `WalletAssignmentEvent.expectedAmountAtomic` for checkout sessions (portal / gateway transaction payloads).
 *
 * @param {Array<{ walletId: number, depositSessionKey: string | null }>} rows
 * @returns {Promise<Map<string, string>>} composite key `walletId\tdepositSessionKey` → digits-only atomic
 */
export async function loadExpectedAtomicByWalletSessionForTransactions(rows) {
  const pairs = [];
  const seen = new Set();
  for (const t of rows) {
    const sk =
      typeof t.depositSessionKey === "string" ? t.depositSessionKey.trim() : "";
    if (!sk) continue;
    const ck = `${t.walletId}\t${sk}`;
    if (seen.has(ck)) continue;
    seen.add(ck);
    pairs.push({ walletId: t.walletId, depositSessionKey: sk });
  }
  if (!pairs.length) return new Map();
  const evs = await prisma.walletAssignmentEvent.findMany({
    where: {
      OR: pairs.map((p) => ({
        walletId: p.walletId,
        depositSessionKey: p.depositSessionKey,
        ...ACTIVE,
      })),
      ...ACTIVE,
    },
    select: {
      id: true,
      walletId: true,
      depositSessionKey: true,
      expectedAmountAtomic: true,
    },
    orderBy: { id: "desc" },
  });
  const map = new Map();
  for (const e of evs) {
    const sk =
      typeof e.depositSessionKey === "string"
        ? e.depositSessionKey.trim()
        : "";
    if (!sk) continue;
    const key = `${e.walletId}\t${sk}`;
    if (map.has(key)) continue;
    const raw = e.expectedAmountAtomic?.trim();
    if (raw && /^\d+$/.test(raw)) map.set(key, raw);
  }
  return map;
}

/**
 * @param {{ walletId: number, depositSessionKey: string | null, tokenDecimals: number }} t
 * @param {Map<string, string>} expectedByKey
 * @returns {{ requested_amount_atomic: string | null, requested_amount_decimal: string | null }}
 */
export function requestedAmountFieldsForTransaction(t, expectedByKey) {
  const sk =
    typeof t.depositSessionKey === "string" ? t.depositSessionKey.trim() : "";
  const req =
    sk && expectedByKey.has(`${t.walletId}\t${sk}`)
      ? expectedByKey.get(`${t.walletId}\t${sk}`) ?? null
      : null;
  return {
    requested_amount_atomic: req,
    requested_amount_decimal:
      req != null
        ? formatAtomicAmountString(req, t.tokenDecimals)
        : null,
  };
}

/**
 * `transactions.amount` is always **on-chain received** (atomic integer string). Optional
 * checkout expectation comes from `WalletAssignmentEvent.expected_amount_atomic` (digits-only).
 *
 * @param {{ amount: string | unknown, tokenDecimals: number }} t
 * @param {string | null | undefined} expectedAtomicNullable — digits-only atomic from assignment event, else null
 * @returns {{
 *   expected_amount_atomic: string | null,
 *   expected_amount_decimal: string | null,
 *   received_amount_atomic: string,
 *   received_amount_decimal: string,
 * }}
 */
export function expectedReceivedAmountQuad(t, expectedAtomicNullable) {
  const recv = String(t.amount ?? "0").trim();
  let expDigits = null;
  if (typeof expectedAtomicNullable === "string") {
    const x = expectedAtomicNullable.trim();
    if (/^\d+$/.test(x)) expDigits = x;
  }
  return {
    expected_amount_atomic: expDigits,
    expected_amount_decimal:
      expDigits != null
        ? formatAtomicAmountString(expDigits, t.tokenDecimals)
        : null,
    received_amount_atomic: recv,
    received_amount_decimal: formatAtomicAmountString(recv, t.tokenDecimals),
  };
}

/**
 * Same as {@link expectedReceivedAmountQuad} using a preloaded assignment-event map.
 *
 * @param {{ walletId: number, depositSessionKey: string | null, amount: string | unknown, tokenDecimals: number }} t
 * @param {Map<string, string>} expectedByKey
 */
export function expectedReceivedAmountQuadForTransaction(t, expectedByKey) {
  const sk =
    typeof t.depositSessionKey === "string" ? t.depositSessionKey.trim() : "";
  const exp =
    sk && expectedByKey.has(`${t.walletId}\t${sk}`)
      ? expectedByKey.get(`${t.walletId}\t${sk}`) ?? null
      : null;
  return expectedReceivedAmountQuad(t, exp);
}

/**
 * Nested `checkout` / `received` for payment webhooks and gateway transaction list (same numbers as flat quad).
 *
 * @param {{
 *   expected_amount_atomic: string | null,
 *   expected_amount_decimal: string | null,
 *   received_amount_atomic: string,
 *   received_amount_decimal: string,
 * }} quad
 * @returns {{
 *   checkout: { atomic: string, decimal: string | null } | null,
 *   received: { atomic: string, decimal: string },
 * }}
 */
export function paymentWebhookAmountGroups(quad) {
  const checkout =
    quad.expected_amount_atomic != null
      ? {
          atomic: quad.expected_amount_atomic,
          decimal: quad.expected_amount_decimal,
        }
      : null;
  return {
    checkout,
    received: {
      atomic: quad.received_amount_atomic,
      decimal: quad.received_amount_decimal,
    },
  };
}
