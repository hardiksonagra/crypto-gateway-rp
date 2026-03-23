import { TxStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { notifyPaymentSuccess } from "./callback-service.js";

export async function retryStuckSuccessCallbacks(limit = 30) {
  const rows = await prisma.transaction.findMany({
    where: {
      status: TxStatus.success,
      callbackDeliveredAt: null,
      wallet: { user: { merchant: { callbackUrl: { not: null } } } },
    },
    select: { id: true },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });
  for (const r of rows) {
    try {
      await notifyPaymentSuccess(r.id);
    } catch (e) {
      logger.error("retry callback tick failed", { txId: r.id, err: String(e) });
    }
  }
}
