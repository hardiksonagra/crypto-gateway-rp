import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { requestClientIp } from "./audit-log.js";

const MAX_META_JSON = 14_000;

export { requestClientIp };

/**
 * @param {unknown} body
 * @param {number} [depth]
 * @returns {unknown}
 */
export function redactPanelBody(body, depth = 0) {
  if (depth > 4) return "[nested]";
  if (body == null || typeof body !== "object") return body;
  if (Array.isArray(body)) {
    return body.map((x) => redactPanelBody(x, depth + 1));
  }
  const keyRe =
    /password|secret|token|api_?key|authorization|cipher|private|bearer|hash/i;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (keyRe.test(k)) {
      out[k] = "[redacted]";
    } else if (v != null && typeof v === "object") {
      out[k] = redactPanelBody(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
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
 * @param {string} path
 * @returns {string | null}
 */
export function extractAdminTargetMerchantId(path) {
  const normalized = path.split("?")[0];
  const m = normalized.match(/\/api\/v1\/admin\/merchants\/([^/]+)/);
  return m ? m[1] : null;
}

/**
 * @param {object} p
 * @param {"admin" | "merchant"} p.panel
 * @param {string} p.actorId
 * @param {string} p.actorRole
 * @param {string | null} [p.targetMerchantId]
 * @param {string} p.method
 * @param {string} p.path
 * @param {number} p.httpStatus
 * @param {string} p.summary
 * @param {string | null} [p.ipAddress]
 * @param {Record<string, unknown>} [p.metadata]
 */
export function writePanelAuditLog(p) {
  const meta = truncateMeta(p.metadata ?? {});
  void prisma.panelAuditLog
    .create({
      data: {
        panel: p.panel.slice(0, 32),
        actorId: p.actorId.slice(0, 128),
        actorRole: p.actorRole.slice(0, 32),
        targetMerchantId: p.targetMerchantId?.slice(0, 128) ?? null,
        method: p.method.slice(0, 16),
        path: p.path.slice(0, 2048),
        httpStatus: p.httpStatus,
        summary: p.summary.slice(0, 8000),
        ipAddress: p.ipAddress?.slice(0, 80) ?? null,
        metadata: meta,
      },
    })
    .catch((e) => {
      logger.error("panel_audit_log_write_failed", { err: String(e) });
    });
}

/**
 * Log authenticated profile / session changes (auth router, not admin/merchant route stacks).
 *
 * @param {import("express").Request} req
 * @param {{ path: string, summary: string, metadata?: Record<string, unknown> }} detail
 */
export function logAuthenticatedPortalMutation(req, detail) {
  const sub = req.auth?.sub;
  const role = req.auth?.role;
  if (!sub || typeof role !== "string") return;
  const panel = role === "ADMIN" ? "admin" : "merchant";
  const targetMerchantId = role === "MERCHANT" ? sub : null;
  writePanelAuditLog({
    panel,
    actorId: sub,
    actorRole: role,
    targetMerchantId,
    method: req.method,
    path: detail.path,
    httpStatus: 200,
    summary: detail.summary,
    metadata: detail.metadata ?? {},
    ipAddress: requestClientIp(req),
  });
}
