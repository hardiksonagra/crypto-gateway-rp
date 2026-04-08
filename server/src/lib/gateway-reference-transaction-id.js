import { randomBytes } from "node:crypto";

/**
 * Gateway-generated checkout reference when the merchant omits `transaction_id` (stored in
 * `transactions.transaction_id` / webhook `merchant_transaction_id`). 64 hex chars (256-bit).
 * @returns {string}
 */
export function generateGatewayReferenceTransactionId() {
  return randomBytes(32).toString("hex");
}
