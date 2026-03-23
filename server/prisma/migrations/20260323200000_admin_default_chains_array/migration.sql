-- Replace single default_chain with default_chains enum array on admin_users.

ALTER TABLE "admin_users" ADD COLUMN "default_chains" "Chain"[] NOT NULL DEFAULT ARRAY[]::"Chain"[];

UPDATE "admin_users" SET "default_chains" = ARRAY["default_chain"]::"Chain"[] WHERE "default_chain" IS NOT NULL;

ALTER TABLE "admin_users" DROP COLUMN "default_chain";
