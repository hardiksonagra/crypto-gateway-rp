-- Optional per-merchant TRX funder (encrypted hex private key) for USDT·TRC20 sweep fee top-ups.
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "trx_sweep_funder_private_key_cipher" TEXT;
