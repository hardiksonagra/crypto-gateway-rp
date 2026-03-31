-- Remove `public_id` columns; integer `id` is the only primary / external reference.

ALTER TABLE "admins" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "merchants" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "merchant_settlements" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "users" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "wallets" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "wallet_assignment_events" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "withdrawals" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "panel_audit_logs" DROP COLUMN IF EXISTS "public_id";
ALTER TABLE "scanner_state" DROP COLUMN IF EXISTS "public_id";
