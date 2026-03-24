-- One gateway secret for live and sandbox: copy live API key material to sandbox columns.
UPDATE "admin_users"
SET
  "sandbox_api_key_hash" = "api_key_hash",
  "sandbox_api_key_hint" = "api_key_hint",
  "sandbox_api_key_cipher" = "api_key_cipher"
WHERE "role" = 'MERCHANT'
  AND "api_key_hash" IS NOT NULL;
