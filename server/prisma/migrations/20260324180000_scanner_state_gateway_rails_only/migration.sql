-- Keep only the five gateway scanner rails in scanner_state.
DELETE FROM "scanner_state"
WHERE NOT (
  ("currency" = 'USDT' AND "network" IN ('TRC20', 'ERC20', 'TON', 'BEP20'))
  OR ("currency" = 'TRX' AND "network" = 'TRON')
);

-- Merchants: only chains that have a gateway rail.
UPDATE "admin_users" au
SET "default_chains" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM unnest(au."default_chains") AS c
    WHERE c IN ('TRON'::"Chain", 'ETH'::"Chain", 'BNB'::"Chain", 'TON'::"Chain")
  )
  THEN ARRAY(
    SELECT DISTINCT c
    FROM unnest(au."default_chains") AS c
    WHERE c IN ('TRON'::"Chain", 'ETH'::"Chain", 'BNB'::"Chain", 'TON'::"Chain")
  )
  ELSE ARRAY['TRON']::"Chain"[]
END;

-- Re-align default currency/network with first allowed chain.
UPDATE "admin_users"
SET
  "default_currency" = CASE COALESCE("default_chains"[1]::text, '')
    WHEN 'TRON' THEN 'USDT'
    WHEN 'ETH' THEN 'USDT'
    WHEN 'BNB' THEN 'USDT'
    WHEN 'TON' THEN 'USDT'
    ELSE 'USDT'
  END,
  "default_network" = CASE COALESCE("default_chains"[1]::text, '')
    WHEN 'TRON' THEN 'TRC20'
    WHEN 'ETH' THEN 'ERC20'
    WHEN 'BNB' THEN 'BEP20'
    WHEN 'TON' THEN 'TON'
    ELSE 'TRC20'
  END
WHERE cardinality("default_chains") >= 1;
