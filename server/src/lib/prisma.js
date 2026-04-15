import { Prisma, PrismaClient } from "@prisma/client";
import { disableActiveRowSoftDeleteFilter } from "./active-row.js";
import { logger } from "./logger.js";

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

let activeRowPrismaSyncDone = false;

/**
 * If the deployed Prisma Client was generated from a schema **without** `deletedAt` on
 * `Wallet`, Prisma rejects `where: { deletedAt: null }`. We then strip {@link ACTIVE} so the
 * process can run until `npm run prisma:generate -w server` (after `prisma migrate deploy`).
 *
 * Call once before any `where: { ...ACTIVE }` query (API `main`, cron `bootstrapCronRuntime`).
 *
 * @returns {Promise<void>}
 */
export async function syncActiveRowWithGeneratedPrismaClient() {
  if (activeRowPrismaSyncDone) return;
  activeRowPrismaSyncDone = true;
  try {
    await prisma.$connect();
    await prisma.wallet.findFirst({
      where: { deletedAt: null },
      take: 1,
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientValidationError &&
      String(e.message).includes("Unknown argument `deletedAt`")
    ) {
      disableActiveRowSoftDeleteFilter();
      logger.warn("prisma_client_missing_deleted_at_on_wallet", {
        event: "prisma_client_missing_deleted_at_on_wallet",
        message:
          "Omitting soft-delete `where` fragments for this process. On the server run: cd server && npx prisma migrate deploy && npx prisma generate",
      });
    } else {
      throw e;
    }
  }
}
