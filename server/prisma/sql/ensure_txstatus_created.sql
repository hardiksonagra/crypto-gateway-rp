-- Optional manual step if migrate was not run (Postgres enum "TxStatus").
-- If 'created' already exists, the ALTER may error — ignore or use IF NOT EXISTS on PG15+.

ALTER TYPE "TxStatus" ADD VALUE 'created';
