-- Merchant default currency/network for gateway when integrator omits them.
ALTER TABLE "admin_users" ADD COLUMN "default_currency" TEXT NOT NULL DEFAULT 'USDT';
ALTER TABLE "admin_users" ADD COLUMN "default_network" TEXT NOT NULL DEFAULT 'TRC20';

UPDATE "admin_users" SET
  "default_currency" = CASE COALESCE("default_chains"[1]::text, '')
    WHEN 'TRON' THEN 'USDT'
    WHEN 'ETH' THEN 'USDT'
    WHEN 'BNB' THEN 'USDT'
    WHEN 'TON' THEN 'USDT'
    WHEN 'POLYGON' THEN 'MATIC'
    WHEN 'ARBITRUM' THEN 'ETH'
    WHEN 'OPTIMISM' THEN 'ETH'
    WHEN 'BTC' THEN 'BTC'
    ELSE 'USDT'
  END,
  "default_network" = CASE COALESCE("default_chains"[1]::text, '')
    WHEN 'TRON' THEN 'TRC20'
    WHEN 'ETH' THEN 'ERC20'
    WHEN 'BNB' THEN 'BEP20'
    WHEN 'TON' THEN 'TON'
    WHEN 'POLYGON' THEN 'POLYGON'
    WHEN 'ARBITRUM' THEN 'ARBITRUM'
    WHEN 'OPTIMISM' THEN 'OPTIMISM'
    WHEN 'BTC' THEN 'BTC'
    ELSE 'TRC20'
  END
WHERE cardinality("default_chains") >= 1;

-- Wallets: deposit rail (currency + network) per row; TRON can have both USDT/TRC20 and TRX/TRON.
ALTER TABLE "wallets" ADD COLUMN "currency" TEXT;
ALTER TABLE "wallets" ADD COLUMN "network" TEXT;

UPDATE "wallets" SET
  "currency" = CASE "chain"::text
    WHEN 'ETH' THEN 'ETH'
    WHEN 'BNB' THEN 'BNB'
    WHEN 'POLYGON' THEN 'MATIC'
    WHEN 'ARBITRUM' THEN 'ETH'
    WHEN 'OPTIMISM' THEN 'ETH'
    WHEN 'TRON' THEN 'USDT'
    WHEN 'BTC' THEN 'BTC'
    WHEN 'TON' THEN 'TON'
    ELSE 'ETH'
  END,
  "network" = CASE "chain"::text
    WHEN 'ETH' THEN 'ERC20'
    WHEN 'BNB' THEN 'BEP20'
    WHEN 'POLYGON' THEN 'POLYGON'
    WHEN 'ARBITRUM' THEN 'ARBITRUM'
    WHEN 'OPTIMISM' THEN 'OPTIMISM'
    WHEN 'TRON' THEN 'TRC20'
    WHEN 'BTC' THEN 'BTC'
    WHEN 'TON' THEN 'TON'
    ELSE 'ERC20'
  END;

ALTER TABLE "wallets" ALTER COLUMN "currency" SET NOT NULL;
ALTER TABLE "wallets" ALTER COLUMN "network" SET NOT NULL;

DROP INDEX IF EXISTS "wallets_user_id_chain_key";

CREATE UNIQUE INDEX "wallets_user_id_chain_currency_network_key" ON "wallets"("user_id", "chain", "currency", "network");

-- Scanner: one row per (currency, network); EVM workers advance all rows sharing the same `chain` together.
ALTER TABLE "scanner_state" RENAME TO "scanner_state_legacy";
-- Free the default PK name so the new table can use `scanner_state_pkey` (Postgres keeps the old name on rename).
ALTER TABLE "scanner_state_legacy" RENAME CONSTRAINT "scanner_state_pkey" TO "scanner_state_legacy_pkey";

CREATE TABLE "scanner_state" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "last_block" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scanner_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scanner_state_currency_network_key" ON "scanner_state"("currency", "network");
CREATE INDEX "scanner_state_chain_idx" ON "scanner_state"("chain");

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT replace(gen_random_uuid()::text, '-', ''), v.c, v.n, l."chain", l."last_block", l."updated_at"
FROM "scanner_state_legacy" l
CROSS JOIN LATERAL (VALUES
  ('USDT', 'ERC20'),
  ('ETH', 'ERC20')
) AS v(c, n)
WHERE l."chain" = 'ETH'::"Chain";

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT replace(gen_random_uuid()::text, '-', ''), v.c, v.n, l."chain", l."last_block", l."updated_at"
FROM "scanner_state_legacy" l
CROSS JOIN LATERAL (VALUES
  ('USDT', 'BEP20'),
  ('BNB', 'BEP20')
) AS v(c, n)
WHERE l."chain" = 'BNB'::"Chain";

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT replace(gen_random_uuid()::text, '-', ''), v.c, v.n, l."chain", l."last_block", l."updated_at"
FROM "scanner_state_legacy" l
CROSS JOIN LATERAL (VALUES
  ('USDT', 'POLYGON'),
  ('MATIC', 'POLYGON')
) AS v(c, n)
WHERE l."chain" = 'POLYGON'::"Chain";

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT replace(gen_random_uuid()::text, '-', ''), v.c, v.n, l."chain", l."last_block", l."updated_at"
FROM "scanner_state_legacy" l
CROSS JOIN LATERAL (VALUES
  ('USDT', 'ARBITRUM'),
  ('ETH', 'ARBITRUM')
) AS v(c, n)
WHERE l."chain" = 'ARBITRUM'::"Chain";

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT replace(gen_random_uuid()::text, '-', ''), v.c, v.n, l."chain", l."last_block", l."updated_at"
FROM "scanner_state_legacy" l
CROSS JOIN LATERAL (VALUES
  ('USDT', 'OPTIMISM'),
  ('ETH', 'OPTIMISM')
) AS v(c, n)
WHERE l."chain" = 'OPTIMISM'::"Chain";

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT replace(gen_random_uuid()::text, '-', ''), v.c, v.n, l."chain", l."last_block", l."updated_at"
FROM "scanner_state_legacy" l
CROSS JOIN LATERAL (VALUES
  ('USDT', 'TRC20'),
  ('TRX', 'TRON')
) AS v(c, n)
WHERE l."chain" = 'TRON'::"Chain";

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT replace(gen_random_uuid()::text, '-', ''), v.c, v.n, l."chain", l."last_block", l."updated_at"
FROM "scanner_state_legacy" l
CROSS JOIN LATERAL (VALUES
  ('BTC', 'BTC')
) AS v(c, n)
WHERE l."chain" = 'BTC'::"Chain";

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT replace(gen_random_uuid()::text, '-', ''), v.c, v.n, l."chain", l."last_block", l."updated_at"
FROM "scanner_state_legacy" l
CROSS JOIN LATERAL (VALUES
  ('USDT', 'TON'),
  ('TON', 'TON')
) AS v(c, n)
WHERE l."chain" = 'TON'::"Chain";

DROP TABLE "scanner_state_legacy";
