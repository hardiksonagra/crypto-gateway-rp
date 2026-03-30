import winston from "winston";
import { env } from "../config/env.js";

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

/**
 * Console-friendly lines in development (no JSON blob). Production keeps JSON for aggregators.
 */
const devConsoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ level: true, message: false }),
  winston.format.printf((info) => {
    const ts = String(info.timestamp ?? "");
    const level = String(info.level ?? "info");
    const msg =
      info.message != null && String(info.message).trim() !== ""
        ? String(info.message)
        : "";

    if (info.event === "worker_deposit_scan_tick" && msg) {
      return `${ts} ${level}\n${msg}`;
    }

    if (info.event === "tronscan_addresses_this_tick" && msg) {
      return `${ts} ${level}\n${msg}`;
    }

    if (info.event === "evm_addresses_this_tick" && msg) {
      return `${ts} ${level}\n${msg}`;
    }

    if (info.event === "tronscan_skipped_rail_mismatch" && msg) {
      return `${ts} ${level}\n${msg}`;
    }

    if (info.event === "tronscan_fetch_transactions_summary" && msg) {
      return `${ts} ${level}\n${msg}`;
    }

    if (msg) {
      const parts = [];
      for (const key of Object.keys(info)) {
        if (
          key === "level" ||
          key === "message" ||
          key === "timestamp" ||
          key === "service" ||
          key === "stack"
        ) {
          continue;
        }
        if (key === "event" && info.event === "worker_deposit_scan_tick") continue;
        const v = info[key];
        if (v === undefined) continue;
        const s =
          typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
        parts.push(`${key}=${s}`);
      }
      const suffix = parts.length ? `  (${parts.join(" ")})` : "";
      const stack = info.stack ? `\n${info.stack}` : "";
      return `${ts} ${level} ${msg}${suffix}${stack}`;
    }

    const rest = { ...info };
    delete rest.level;
    delete rest.message;
    delete rest.timestamp;
    delete rest.service;
    const stack = rest.stack;
    delete rest.stack;
    const keys = Object.keys(rest).filter((k) => !k.startsWith("_"));
    if (keys.length === 0) {
      return `${ts} ${level} (empty log)`;
    }
    return `${ts} ${level} ${JSON.stringify(rest)}${stack ? `\n${stack}` : ""}`;
  }),
);

export const logger = winston.createLogger({
  level: env.logLevel,
  format: env.nodeEnv === "production" ? jsonFormat : devConsoleFormat,
  defaultMeta: { service: "crypto-payment-gateway" },
  transports: [new winston.transports.Console()],
});
