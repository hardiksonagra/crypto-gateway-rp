import {
  extractAdminTargetMerchantId,
  redactPanelBody,
  requestClientIp,
  writePanelAuditLog,
} from "../services/panel-audit-log.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * After successful (2xx) mutating requests, append a row to `panel_audit_logs`.
 *
 * @param {"admin" | "merchant"} panel
 */
export function logPanelMutations(panel) {
  return function logPanelMutationsMiddleware(req, res, next) {
    if (!MUTATING.has(req.method)) {
      next();
      return;
    }

    res.once("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const sub = req.auth?.sub;
      const role = req.auth?.role;
      if (!sub || typeof role !== "string") return;

      const path = (req.originalUrl || req.url || "").split("?")[0];
      const targetMerchantId =
        panel === "merchant" ? sub : extractAdminTargetMerchantId(path);

      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? redactPanelBody(req.body)
          : req.body;

      writePanelAuditLog({
        panel,
        actorId: sub,
        actorRole: role,
        targetMerchantId,
        method: req.method,
        path,
        httpStatus: res.statusCode,
        summary: `${req.method} ${path} · ${res.statusCode}`,
        metadata: {
          route_template: req.route?.path ?? null,
          request_body: body ?? null,
        },
        ipAddress: requestClientIp(req),
      });
    });

    next();
  };
}
