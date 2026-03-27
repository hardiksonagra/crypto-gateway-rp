import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const MAX_META_JSON = 14_000;

/**
 * @param {import("express").Request | undefined} req
 * @returns {string | null}
 */
export function requestClientIp(req) {
  if (!req) return null;
  const x = req.headers["x-forwarded-for"];
  if (typeof x === "string" && x.trim()) {
    return x.split(",")[0].trim().slice(0, 80);
  }
  const ip = req.socket?.remoteAddress;
  return ip ? String(ip).slice(0, 80) : null;
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
export function redactGatewayBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const o = { ...body };
  if (typeof o.api_key === "string") o.api_key = "[redacted]";
  return o;
}

function truncateMeta(meta) {
  try {
    const s = JSON.stringify(meta ?? {});
    if (s.length <= MAX_META_JSON) return meta;
    return {
      _truncated: true,
      preview: s.slice(0, MAX_META_JSON),
    };
  } catch {
    return { _error: "metadata_not_serializable" };
  }
}

/**
 * @param {object} p
 * @param {string} p.source
 * @param {string} p.action
 * @param {string | null} [p.merchantId]
 * @param {string} p.actorType
 * @param {string | null} [p.actorId]
 * @param {string | null} [p.actorEmail]
 * @param {string} p.summary
 * @param {string | null} [p.requestMethod]
 * @param {string | null} [p.requestPath]
 * @param {string | null} [p.ipAddress]
 * @param {Record<string, unknown>} [p.metadata]
 */
export function writeAuditLog(p) {
  const meta = truncateMeta(p.metadata ?? {});
  void prisma.auditLog
    .create({
      data: {
        source: p.source.slice(0, 64),
        action: p.action.slice(0, 128),
        merchantId: p.merchantId ?? null,
        actorType: p.actorType.slice(0, 64),
        actorId: p.actorId?.slice(0, 128) ?? null,
        actorEmail: p.actorEmail?.slice(0, 255) ?? null,
        summary: p.summary.slice(0, 8000),
        requestMethod: p.requestMethod?.slice(0, 16) ?? null,
        requestPath: p.requestPath?.slice(0, 2048) ?? null,
        ipAddress: p.ipAddress ?? null,
        metadata: meta,
      },
    })
    .catch((e) => {
      logger.error("audit_log_write_failed", { err: String(e) });
    });
}

/**
 * @param {object} p
 * @param {string} p.merchantId
 * @param {string} p.transactionId
 * @param {string | null} p.url
 * @param {Record<string, unknown>} p.requestBody
 * @param {boolean} p.ok
 * @param {number | null} [p.httpStatus]
 * @param {string | null} [p.responseSnippet]
 * @param {"auto" | "merchant_redeliver" | "admin_redeliver" | "skipped"} p.trigger
 * @param {string | null} [p.actorAdminId]
 * @param {string | null} [p.actorMerchantEmail]
 */
export function logPaymentSuccessCallback(p) {
  const actorType =
    p.trigger === "admin_redeliver"
      ? "admin"
      : p.trigger === "merchant_redeliver"
        ? "merchant_jwt"
        : p.trigger === "skipped"
          ? "system"
          : "system";
  const summary =
    p.trigger === "skipped"
      ? `Callback skipped (no URL) for tx ${p.transactionId}`
      : p.ok
        ? `payment.success webhook delivered (HTTP ${p.httpStatus ?? "?"}) — tx ${p.transactionId}`
        : `payment.success webhook failed — tx ${p.transactionId}`;

  writeAuditLog({
    source: "callback",
    action:
      p.trigger === "skipped"
        ? "callback.payment_success_skipped"
        : p.ok
          ? "callback.payment_success_delivered"
          : "callback.payment_success_failed",
    merchantId: p.merchantId,
    actorType,
    actorId:
      p.trigger === "admin_redeliver"
        ? p.actorAdminId ?? null
        : null,
    actorEmail: p.actorMerchantEmail ?? null,
    summary,
    metadata: {
      transaction_id: p.transactionId,
      trigger: p.trigger,
      webhook_url: p.url,
      x_webhook_event: "payment.success",
      request_body: p.requestBody,
      response_http_status: p.httpStatus ?? null,
      response_body_snippet: p.responseSnippet?.slice(0, 2000) ?? null,
    },
  });
}
