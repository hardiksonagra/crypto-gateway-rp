import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signAuthToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn || "7d" });
}

export function verifyAuthToken(token) {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !("sub" in decoded) ||
    !("role" in decoded)
  ) {
    throw new Error("INVALID_TOKEN");
  }
  return { sub: String(decoded.sub), role: decoded.role };
}
