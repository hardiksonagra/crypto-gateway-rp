-- Ensure every (currency, network) pair used by workers exists, even if the old scanner_state
-- only had rows for e.g. TRON. New rows copy MAX(last_block) for that chain from existing rows, else 0.

INSERT INTO "scanner_state" ("id", "currency", "network", "chain", "last_block", "updated_at")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  d.c,
  d.n,
  d.ch::"Chain",
  COALESCE(
    (SELECT MAX(s."last_block") FROM "scanner_state" s WHERE s."chain" = d.ch::"Chain"),
    0
  ),
  NOW()
FROM (
  VALUES
    ('USDT', 'ERC20', 'ETH'),
    ('ETH', 'ERC20', 'ETH'),
    ('USDT', 'BEP20', 'BNB'),
    ('BNB', 'BEP20', 'BNB'),
    ('USDT', 'POLYGON', 'POLYGON'),
    ('MATIC', 'POLYGON', 'POLYGON'),
    ('USDT', 'ARBITRUM', 'ARBITRUM'),
    ('ETH', 'ARBITRUM', 'ARBITRUM'),
    ('USDT', 'OPTIMISM', 'OPTIMISM'),
    ('ETH', 'OPTIMISM', 'OPTIMISM'),
    ('USDT', 'TRC20', 'TRON'),
    ('TRX', 'TRON', 'TRON'),
    ('BTC', 'BTC', 'BTC'),
    ('USDT', 'TON', 'TON'),
    ('TON', 'TON', 'TON')
) AS d(c, n, ch)
WHERE NOT EXISTS (
  SELECT 1
  FROM "scanner_state" s2
  WHERE s2."currency" = d.c AND s2."network" = d.n
);
