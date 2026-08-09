import { ACTIVE } from "./active-row.js";
import { prisma } from "./prisma.js";

/**
 * Active RP Swap “main wallet” TRON address for a merchant (USDT·TRC20 consolidation target).
 * Required from-address for live TRON gateway payouts / fee SunSwap (no platform hot fallback).
 *
 * @param {number} merchantId
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} [db]
 * @returns {Promise<string | null>} base58 address or null
 */
export async function getRpMerchantSwapMainTronAddress(merchantId, db = prisma) {
  const id =
    typeof merchantId === "number" && Number.isInteger(merchantId)
      ? merchantId
      : parseInt(String(merchantId ?? ""), 10);
  if (!Number.isInteger(id) || id < 1) return null;

  const row = await db.rpMerchantSwapConfig.findFirst({
    where: {
      merchantId: id,
      isActive: true,
      ...ACTIVE,
    },
    select: { tronAddress: true },
    orderBy: { id: "asc" },
  });
  const addr = String(row?.tronAddress ?? "").trim();
  return addr || null;
}
