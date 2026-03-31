import { verifyAuthToken } from "../lib/auth-jwt.js";
import { prisma } from "../lib/prisma.js";
import { PORTAL_ROLE_ADMIN, PORTAL_ROLE_MERCHANT } from "../constants/portal-role.js";

/**
 * Bearer JWT + live DB check: account must exist, not soft-deleted (`deleted_at`), and active.
 *
 * @param {...string} allowed Optional role allow-list (`ADMIN` / `MERCHANT`) from the JWT.
 */
export function requireAuth(...allowed) {
  return async (req, res, next) => {
    const h = req.headers.authorization;
    const raw =
      typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!raw) {
      res.status(401).json({ error: "missing_bearer_token" });
      return;
    }

    let payload;
    try {
      payload = verifyAuthToken(raw);
    } catch {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const role = payload.role;
    if (role !== PORTAL_ROLE_ADMIN && role !== PORTAL_ROLE_MERCHANT) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const subId = parseInt(String(payload.sub ?? "").trim(), 10);
    if (!Number.isInteger(subId) || subId < 1) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    let account;
    try {
      if (role === PORTAL_ROLE_ADMIN) {
        account = await prisma.admin.findUnique({
          where: { id: subId },
          select: { isActive: true, deletedAt: true },
        });
      } else {
        account = await prisma.merchant.findUnique({
          where: { id: subId },
          select: { isActive: true, deletedAt: true },
        });
      }
    } catch {
      res.status(500).json({ error: "internal error" });
      return;
    }

    if (!account) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    if (!account.isActive) {
      res.status(401).json({
        error: "account_deactivated",
        message: "This account is inactive. You have been signed out.",
      });
      return;
    }
    if (account.deletedAt) {
      res.status(401).json({
        error: "account_removed",
        message: "This account has been removed. You have been signed out.",
      });
      return;
    }
    if (allowed.length > 0 && !allowed.includes(role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    req.auth = payload;
    next();
  };
}
