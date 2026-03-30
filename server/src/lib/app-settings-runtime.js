import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { env } from "../config/env.js";
import {
  APP_SETTING_DEF_BY_KEY,
  APP_SETTING_DEFINITIONS,
} from "./app-settings-registry.js";

/** @type {Map<string, string>} */
let cacheMap = new Map();

/**
 * @param {string} key
 * @returns {boolean}
 */
function hasDbOverride(key) {
  return cacheMap.has(key);
}

/**
 * @param {string} key
 * @returns {string | undefined}
 */
function rawDbValue(key) {
  return cacheMap.get(key);
}

/**
 * @param {string} key
 * @param {() => string} fallbackFn
 * @returns {string}
 */
export function getResolvedString(key, fallbackFn) {
  if (!APP_SETTING_DEF_BY_KEY.has(key)) return fallbackFn();
  if (hasDbOverride(key)) {
    const v = rawDbValue(key);
    return v != null ? String(v) : fallbackFn();
  }
  return fallbackFn();
}

/**
 * @param {string} key
 * @param {() => number} fallbackFn
 */
export function getResolvedInt(key, fallbackFn) {
  if (!APP_SETTING_DEF_BY_KEY.has(key)) return fallbackFn();
  if (hasDbOverride(key)) {
    const raw = rawDbValue(key)?.trim() ?? "";
    if (raw === "") return fallbackFn();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallbackFn();
  }
  return fallbackFn();
}

/**
 * @param {string} key
 * @param {() => boolean} fallbackFn
 */
export function getResolvedBool(key, fallbackFn) {
  if (!APP_SETTING_DEF_BY_KEY.has(key)) return fallbackFn();
  if (hasDbOverride(key)) {
    const s = String(rawDbValue(key) ?? "")
      .trim()
      .toLowerCase();
    if (s === "") return fallbackFn();
    return s === "true" || s === "1" || s === "yes";
  }
  return fallbackFn();
}

/**
 * Same semantics as env `GATEWAY_TRON_USDT_ONLY`: false only for false/0.
 * @param {string} key
 * @param {() => boolean} fallbackFn
 */
export function getResolvedBoolTronGateway(key, fallbackFn) {
  if (!APP_SETTING_DEF_BY_KEY.has(key)) return fallbackFn();
  if (hasDbOverride(key)) {
    const s = String(rawDbValue(key) ?? "")
      .trim()
      .toLowerCase();
    if (s === "") return fallbackFn();
    return s !== "false" && s !== "0";
  }
  return fallbackFn();
}

/**
 * @param {string} key
 * @param {() => bigint} fallbackFn
 */
export function getResolvedBigInt(key, fallbackFn) {
  if (!APP_SETTING_DEF_BY_KEY.has(key)) return fallbackFn();
  if (hasDbOverride(key)) {
    const raw = rawDbValue(key)?.trim() ?? "";
    if (raw === "") return fallbackFn();
    try {
      return BigInt(raw);
    } catch {
      return fallbackFn();
    }
  }
  return fallbackFn();
}

/**
 * @param {string} key
 * @param {() => string} fallbackFn — raw JSON string from env
 */
export function getResolvedJsonRaw(key, fallbackFn) {
  return getResolvedString(key, fallbackFn);
}

function applyLoggerLevel() {
  const lvl = getResolvedString("LOG_LEVEL", () => env.logLevel);
  logger.level = lvl;
  for (const t of logger.transports) {
    t.level = lvl;
  }
}

export async function loadAppSettingsFromDatabase() {
  const rows = await prisma.appSetting.findMany();
  cacheMap = new Map(rows.map((r) => [r.key, r.value]));
  applyLoggerLevel();
}

export async function refreshAppSettingsCache() {
  await loadAppSettingsFromDatabase();
}

const MASK = "••••••••";

/**
 * @param {import("./app-settings-registry.js").AppSettingDef} def
 * @param {string} envValue
 */
function coerceEnvStringForDisplay(def, envValue) {
  if (def.sensitive && envValue?.trim()) return MASK;
  if (def.type === "json" && envValue?.trim()) {
    try {
      return JSON.stringify(JSON.parse(envValue), null, 2);
    } catch {
      return envValue;
    }
  }
  return envValue ?? "";
}

/**
 * @returns {string}
 */
function envFallbackString(key) {
  switch (key) {
    case "LOG_LEVEL":
      return env.logLevel;
    case "CLIENT_ORIGINS":
      return env.clientOrigins.join(",");
    case "APP_PUBLIC_URL":
      return env.appPublicUrl;
    case "PAYMENT_PAGE_PUBLIC_URL":
      return env.paymentPagePublicUrl;
    case "PASSWORD_RESET_TTL_MINUTES":
      return String(env.passwordResetTtlMinutes);
    case "SMTP_HOST":
      return env.smtpHost ?? "";
    case "SMTP_PORT":
      return String(env.smtpPort);
    case "SMTP_SECURE":
      return env.smtpSecure ? "true" : "false";
    case "SMTP_USER":
      return env.smtpUser ?? "";
    case "SMTP_PASS":
      return env.smtpPass ?? "";
    case "SMTP_FROM":
      return env.smtpFrom;
    case "CONFIRMATIONS_EVM":
      return String(env.confirmationsEvm);
    case "CONFIRMATIONS_TRON":
      return String(env.confirmationsTron);
    case "CONFIRMATIONS_BTC":
      return String(env.confirmationsBtc);
    case "CONFIRMATIONS_TON":
      return String(env.confirmationsTon);
    case "CONFIRMATIONS_SOLANA":
      return String(env.confirmationsSolana);
    case "WORKER_POLL_INTERVAL_MS":
      return String(env.workerPollMs);
    case "WALLET_SCAN_TTL_MINUTES":
      return String(env.walletScanTtlMinutes);
    case "WALLET_ASSIGNMENT_HOLD_MINUTES":
      return String(env.walletAssignmentHoldMinutes);
    case "LATE_DEPOSIT_RECHECK_HOURS":
      return String(env.lateDepositRecheckHours);
    case "WORKER_LOG_RAIL_COUNTS":
      return env.workerLogRailCounts;
    case "DEPOSIT_SCANNER_TRON_ONLY":
      return env.depositScannerTronOnly ? "true" : "false";
    case "RPC_ETH":
      return env.rpcEth;
    case "RPC_BNB":
      return env.rpcBnb;
    case "RPC_POLYGON":
      return env.rpcPolygon;
    case "RPC_ARBITRUM":
      return env.rpcArbitrum;
    case "RPC_OPTIMISM":
      return env.rpcOptimism;
    case "TRON_FULL_NODE":
      return env.tronFullNode;
    case "TRONSCAN_API_BASE":
      return env.tronscanApiBase ?? "";
    case "TRONSCAN_API_KEY":
      return env.tronscanApiKey ?? "";
    case "TRON_SOLIDITY_NODE":
      return env.tronSolidityNode;
    case "TRON_EVENT_SERVER":
      return env.tronEventServer;
    case "TRON_API_KEY":
      return env.tronApiKey ?? "";
    case "TON_API_BASE":
      return env.tonApiBase;
    case "TON_API_KEY":
      return env.tonApiKey ?? "";
    case "BTC_EXPLORER_API_BASE":
      return env.btcExplorerApiBase;
    case "SWEEP_MASTER_EVM":
      return env.sweepMasterEvm ?? "";
    case "SWEEP_MASTER_TRON":
      return env.sweepMasterTron ?? "";
    case "SWEEP_MASTER_TRX":
      return env.sweepMasterTrx ?? "";
    case "SWEEP_MASTER_USDT_ETH":
      return env.sweepMasterUsdtEth ?? "";
    case "SWEEP_MASTER_USDT_BNB":
      return env.sweepMasterUsdtBnb ?? "";
    case "SWEEP_MASTER_BTC":
      return env.sweepMasterBtc ?? "";
    case "SWEEP_MASTER_SOLANA":
      return env.sweepMasterSolana ?? "";
    case "SWEEP_TRX_FUNDER_ADDRESS":
      return env.sweepTrxFunderAddress ?? "";
    case "SWEEP_TRX_TOPUP_SUN":
      return env.sweepTrxTopupSun.toString();
    case "SWEEP_TRON_USDT_MIN_ATOMIC":
      return env.sweepTronUsdtMinAtomic.toString();
    case "SWEEP_TRON_AUTO_CRON_ENABLED":
      return env.sweepTronAutoCronEnabled ? "true" : "false";
    case "SWEEP_TRON_AUTO_CRON_MINUTES":
      return String(env.sweepTronAutoCronMinutes);
    case "SOLANA_RPC_URL":
      return env.solanaRpcUrl;
    case "SOLANA_USDT_MINT":
      return env.solanaUsdtMint;
    case "GATEWAY_SANDBOX":
      return env.gatewaySandbox ? "true" : "false";
    case "GATEWAY_TRON_USDT_ONLY":
      return env.gatewayTronUsdtOnly ? "true" : "false";
    case "OUTBOUND_RPC_MAX_PER_SECOND":
      return String(env.outboundRpcMaxPerSecond);
    case "ERC20_CONTRACTS": {
      const raw = process.env.ERC20_CONTRACTS?.trim();
      return raw && raw.length > 0 ? raw : "{}";
    }
    case "TRC20_CONTRACTS": {
      const raw = process.env.TRC20_CONTRACTS?.trim();
      return raw && raw.length > 0 ? raw : "{}";
    }
    case "TON_JETTON_CONTRACTS": {
      const raw = process.env.TON_JETTON_CONTRACTS?.trim();
      return raw && raw.length > 0 ? raw : "{}";
    }
    default:
      return "";
  }
}

/**
 * @param {string} key
 * @param {string} normalized — already validated / normalized storage form
 * @returns {boolean}
 */
function nonSensitiveMatchesEnvDefault(key, normalized) {
  const def = APP_SETTING_DEF_BY_KEY.get(key);
  if (!def || def.sensitive) return false;
  const envVal = envFallbackString(key);
  if (def.type === "json") {
    try {
      return (
        JSON.stringify(JSON.parse(normalized)) ===
        JSON.stringify(JSON.parse(envVal || "{}"))
      );
    } catch {
      return normalized.trim() === envVal.trim();
    }
  }
  if (def.type === "comma_origins") {
    const a = normalized
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
      .join(",");
    const b = envVal
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
      .join(",");
    return a === b;
  }
  return normalized.trim() === envVal.trim();
}

/**
 * @param {string} key
 * @param {string} stored
 */
function validateStoredValue(key, stored) {
  const def = APP_SETTING_DEF_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  const s = stored.trim();
  switch (def.type) {
    case "int": {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n)) throw new Error(`${key}: invalid integer`);
      return String(n);
    }
    case "bool":
    case "bool_tron_gateway": {
      const low = s.toLowerCase();
      if (!["true", "false", "1", "0", "yes", "no"].includes(low)) {
        throw new Error(`${key}: use true/false`);
      }
      return low === "yes" || low === "true" || low === "1" ? "true" : "false";
    }
    case "bigint": {
      try {
        const b = BigInt(s);
        if (b < 1n && key === "SWEEP_TRX_TOPUP_SUN") {
          throw new Error(`${key}: must be >= 1`);
        }
        if (b < 0n) throw new Error(`${key}: must be non-negative`);
        return b.toString();
      } catch (e) {
        if (e instanceof SyntaxError) throw new Error(`${key}: invalid bigint`);
        throw e;
      }
    }
    case "json": {
      const p = JSON.parse(s);
      if (p === null || typeof p !== "object" || Array.isArray(p)) {
        throw new Error(`${key}: JSON must be an object`);
      }
      return JSON.stringify(p);
    }
    case "comma_origins":
      return s;
    case "string":
    default:
      return stored;
  }
}

/**
 * Whether a bootstrap `env` value should be written to `app_settings` (skip empty / pure defaults).
 * @param {import("./app-settings-registry.js").AppSettingDef} def
 * @param {string} raw from `envFallbackString`
 */
function shouldWriteEnvValueToAppSettings(def, raw) {
  if (def.sensitive) return Boolean(raw?.trim());
  if (def.type === "json") {
    const fromEnv = process.env[def.key]?.trim();
    if (fromEnv) return true;
    const t = raw?.trim() ?? "";
    return t !== "" && t !== "{}";
  }
  if (def.type === "bool" || def.type === "bool_tron_gateway") return true;
  if (def.type === "int" || def.type === "bigint") return true;
  return Boolean(raw?.trim());
}

/**
 * Upsert every applicable row in `app_settings` from the current process environment (`DATABASE_URL` target DB).
 * Use after `prisma migrate deploy` so `app_settings` exists. Safe to re-run (idempotent upserts).
 *
 * @returns {Promise<{ upserted: number, skipped: number }>}
 */
export async function upsertAppSettingsFromCurrentEnv() {
  /** @type {{ key: string, value: string }[]} */
  const ops = [];
  for (const def of APP_SETTING_DEFINITIONS) {
    const raw = envFallbackString(def.key);
    if (!shouldWriteEnvValueToAppSettings(def, raw)) continue;
    try {
      const normalized = validateStoredValue(def.key, raw);
      ops.push({ key: def.key, value: normalized });
    } catch (e) {
      logger.warn("sync_app_settings_skip_invalid", {
        key: def.key,
        err: String(e),
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const op of ops) {
      await tx.appSetting.upsert({
        where: { key: op.key },
        create: { key: op.key, value: op.value },
        update: { value: op.value },
      });
    }
  });

  await loadAppSettingsFromDatabase();

  const skipped = APP_SETTING_DEFINITIONS.length - ops.length;
  return { upserted: ops.length, skipped };
}

/**
 * Admin GET payload.
 */
export function buildAppSettingsAdminList() {
  return APP_SETTING_DEFINITIONS.map((def) => {
    const envVal = envFallbackString(def.key);
    const dbVal = hasDbOverride(def.key) ? rawDbValue(def.key) : null;
    const effective = hasDbOverride(def.key)
      ? String(dbVal ?? "")
      : envVal;
    let displayEffective = effective;
    if (def.sensitive && (dbVal?.trim() || envVal?.trim())) {
      displayEffective = MASK;
    }
    if (def.type === "json" && effective?.trim()) {
      try {
        displayEffective = JSON.stringify(JSON.parse(effective), null, 2);
      } catch {
        /* keep raw */
      }
    }
    return {
      key: def.key,
      label: def.label,
      category: def.category,
      type: def.type,
      sensitive: Boolean(def.sensitive),
      has_db_override: Boolean(dbVal != null && hasDbOverride(def.key)),
      env_display: coerceEnvStringForDisplay(def, envVal),
      effective_display: displayEffective,
      /** For Formik: secrets never prefilled; bool empty = follow .env (no DB row). */
      form_initial: def.sensitive
        ? ""
        : def.type === "bool" || def.type === "bool_tron_gateway"
          ? hasDbOverride(def.key)
            ? (() => {
                const s = String(dbVal ?? "")
                  .trim()
                  .toLowerCase();
                return s === "true" || s === "1" ? "true" : "false";
              })()
            : ""
        : def.type === "json"
          ? (() => {
              const src = hasDbOverride(def.key)
                ? String(dbVal ?? "")
                : envVal;
              if (!src?.trim()) return "{}";
              try {
                return JSON.stringify(JSON.parse(src), null, 2);
              } catch {
                return src;
              }
            })()
          : hasDbOverride(def.key)
            ? String(dbVal ?? "")
            : envVal,
    };
  });
}

/**
 * @param {Record<string, string | null | undefined>} patch
 */
export async function applyAppSettingsPatch(patch) {
  /** @type {{ type: "delete" | "upsert", key: string, value?: string }[]} */
  const ops = [];

  for (const [key, raw] of Object.entries(patch)) {
    if (!APP_SETTING_DEF_BY_KEY.has(key)) {
      throw new Error(`Unknown setting key: ${key}`);
    }
    const def = APP_SETTING_DEF_BY_KEY.get(key);

    if (raw === null || raw === undefined) continue;

    const str = String(raw);
    if (def.sensitive) {
      const t = str.trim();
      if (t === "") {
        if (hasDbOverride(key)) {
          ops.push({ type: "delete", key });
        }
        continue;
      }
      const normalized = validateStoredValue(key, t);
      ops.push({ type: "upsert", key, value: normalized });
      continue;
    }

    const t = str.trim();
    if (t === "") {
      ops.push({ type: "delete", key });
      continue;
    }

    const normalized = validateStoredValue(key, t);
    if (nonSensitiveMatchesEnvDefault(key, normalized)) {
      if (hasDbOverride(key)) {
        ops.push({ type: "delete", key });
      }
      continue;
    }
    ops.push({ type: "upsert", key, value: normalized });
  }

  await prisma.$transaction(async (tx) => {
    for (const op of ops) {
      if (op.type === "delete") {
        await tx.appSetting.deleteMany({ where: { key: op.key } });
      } else {
        await tx.appSetting.upsert({
          where: { key: op.key },
          create: { key: op.key, value: op.value ?? "" },
          update: { value: op.value ?? "" },
        });
      }
    }
  });

  await loadAppSettingsFromDatabase();
}
