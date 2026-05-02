ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "auto_swap_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "auto_swap_settings_json" JSONB NOT NULL DEFAULT '{}'::jsonb;
