import { verifyAuthToken } from "../lib/auth-jwt.js";
import { prisma } from "../lib/prisma.js";

/**
 * Bearer JWT + live DB check: user must exist, not soft-deleted (`deleted_at`), and active.
 *
 * @param {...import("@prisma/client").AdminRole} allowed Optional role allow-list (checked against DB role).
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

    let user;
    try {
      user = await prisma.adminUser.findUnique({
        where: { id: payload.sub },
        select: { isActive: true, role: true, deletedAt: true },
      });
    } catch {
      res.status(500).json({ error: "internal error" });
      return;
    }

    if (!user) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    if (!user.isActive) {
      res.status(401).json({
        error: "account_deactivated",
        message: "This account is inactive. You have been signed out.",
      });
      return;
    }
    if (user.deletedAt) {
      res.status(401).json({
        error: "account_removed",
        message: "This account has been removed. You have been signed out.",
      });
      return;
    }
    if (allowed.length > 0 && !allowed.includes(user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    req.auth = payload;
    next();
  };
}
