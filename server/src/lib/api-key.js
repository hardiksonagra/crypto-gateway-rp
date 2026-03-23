import crypto from "crypto";

const PREFIX = "cpg_live_";

export function hashApiKey(secret) {
  return crypto.createHash("sha256").update(secret.trim(), "utf8").digest("hex");
}

export function generateApiKey() {
  return PREFIX + crypto.randomBytes(24).toString("hex");
}
