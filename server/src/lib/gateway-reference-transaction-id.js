import { randomBytes } from "node:crypto";

/**
 * Gateway-generated checkout reference when the merchant omits `transaction_id` (stored as
 * `Transaction.referenceTransactionId`; echoed as API `reference_id` / `transaction_id` and webhook
 * `reference_id` / `merchant_transaction_id`). 64 hex chars (256-bit).
 * @returns {string}
 */
export function generateGatewayReferenceTransactionId() {
  return randomBytes(32).toString("hex");
}
