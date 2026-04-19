-- Run once against the same database as DATABASE_URL (fixes Postgres 22P02:
-- invalid input value for enum "TxStatus": "underpaid").
--
-- Preferred: from repo root
--   cd server && npx prisma migrate deploy
--
-- Or with psql:
--   psql "$DATABASE_URL" -f prisma/sql/ensure_txstatus_underpaid.sql
--
-- If "underpaid" already exists, the first line errors — safe to ignore.
-- PostgreSQL 15+ may use: ALTER TYPE "TxStatus" ADD VALUE IF NOT EXISTS 'underpaid';

ALTER TYPE "TxStatus" ADD VALUE 'underpaid';

ALTER TABLE "wallet_assignment_events"
  ADD COLUMN IF NOT EXISTS "expected_amount_atomic" VARCHAR(128);
