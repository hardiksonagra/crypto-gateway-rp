-- Per-rail payout limits + treasury hints (merchant portal Gateway & webhooks).
ALTER TABLE "merchants" ADD COLUMN "payout_rails_policy_json" JSONB NOT NULL DEFAULT '{}';
