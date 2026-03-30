-- CreateTable
CREATE TABLE "wallet_assignment_events" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "environment" "MerchantGatewayEnv" NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_assignment_events_user_id_created_at_idx" ON "wallet_assignment_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_assignment_events_merchant_id_environment_idx" ON "wallet_assignment_events"("merchant_id", "environment");

-- AddForeignKey
ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
