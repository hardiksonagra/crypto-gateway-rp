import { prisma } from "./prisma.js";
import { ACTIVE } from "./active-row.js";
import { formatAtomicAmountString } from "./format-atomic-amount.js";

/**
 * Load `WalletAssignmentEvent.expectedAmountAtomic` for checkout sessions on this page.
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
