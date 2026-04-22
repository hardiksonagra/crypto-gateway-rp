import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { env } from "../config/env.js";
import {
  APP_SETTING_DEF_BY_KEY,
  APP_SETTING_DEFINITIONS,
} from "./app-settings-registry.js";
import { normalizeChainEnabledStoredObject } from "./chain-enable.js";
import { pruneMerchantsAfterSupportedChainsChange } from "./prune-merchants-after-supported-chains-change.js";

/** @type {Map<string, string>} */
let cacheMap = new Map();

/** AppSetting soft-delete scope only (never tied to mutable {@link ACTIVE}). */
const APP_SETTING_NOT_DELETED = Object.freeze({ deletedAt: null });

/**
 * `null` = not yet probed. When the deployed Prisma Client predates `AppSetting.deletedAt`,
 * queries must omit soft-delete filters (run `npm run prisma:generate -w server` after deploy).
 *
 * @type {boolean | null}
 */
let appSettingsClientHasDeletedAt = null;

/**
 * @param {unknown} e
 * @returns {boolean}
 */
function isPrismaAppSettingDeletedAtUnsupported(e) {
  return (
    e instanceof Prisma.PrismaClientValidationError &&
    String(e.message).includes("Unknown argument `deletedAt`")
  );
}

/**
 * Probes once per process whether `AppSetting` accepts `deletedAt` in Prisma where/data.
 */
async function detectAppSettingDeletedAtSupport() {
  if (appSettingsClientHasDeletedAt != null) return;
  try {
    await prisma.appSetting.findFirst({ where: { ...APP_SETTING_NOT_DELETED } });
    appSettingsClientHasDeletedAt = true;
  } catch (e) {
    if (isPrismaAppSettingDeletedAtUnsupported(e)) {
      appSettingsClientHasDeletedAt = false;
      logger.warn("app_setting_prisma_client_missing_deleted_at", {
        event: "app_setting_prisma_client_missing_deleted_at",
        message:
          "Prisma Client has no AppSetting.deletedAt — run `npm run prisma:generate -w server` (and DB migrate) on this host. Using legacy app_settings queries without soft-delete scope.",
      });
    } else {
      throw e;
    }
  }
}

/**
 * @param {import("@prisma/client").Prisma.AppSettingWhereInput} where
 * @returns {Promise<import("@prisma/client").AppSetting | null>}
 */
export async function findAppSettingFirst(where) {
  await detectAppSettingDeletedAtSupport();
  const scope = appSettingsClientHasDeletedAt
    ? { ...APP_SETTING_NOT_DELETED }
    : {};
  return prisma.appSetting.findFirst({ where: { ...where, ...scope } });
}

const USDT6_DECIMALS = 6;
const USDT6_FACTOR = 1_000_000n;

/**
 * @param {string} atomicStr
 * @returns {string}
 */
export function atomicUsdt6ToDecimalDisplay(atomicStr) {
  const t = String(atomicStr ?? "").trim();
  if (!t) return "";
  let b;
  try {
    b = BigInt(t);
  } catch {
    return t;
  }
  if (b < 0n) return t;
  const whole = b / USDT6_FACTOR;
  const frac = b % USDT6_FACTOR;
  if (frac === 0n) return whole.toString();
  const fracStr = frac
    .toString()
    .padStart(USDT6_DECIMALS, "0")
    .replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * Admin-entered USDT amount (e.g. `1`, `0.5`) → atomic string for DB (6 decimals).
 *
 * @param {string} s
 * @returns {string}
 */
export function parseAdminUsdtAmountToAtomicString(s) {
  const t = String(s).trim();
  if (!t) throw new Error("empty value");
  if (!/^\d+(\.\d{0,6})?$/.test(t)) {
    throw new Error(
      "enter a USDT amount with up to 6 decimal places (e.g. 1 or 0.5)",
    );
  }
  const [intPart, fracPart = ""] = t.split(".");
  const whole = BigInt(intPart === "" ? "0" : intPart);
  const fracPadded = (fracPart + "000000").slice(0, USDT6_DECIMALS);
  const frac = BigInt(fracPadded || "0");
  const atomic = whole * USDT6_FACTOR + frac;
  if (atomic < 1n) {
    throw new Error("must be at least 0.000001 USDT");
  }
  return atomic.toString();
}

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
    const s = v != null ? String(v) : "";
    /** Non-empty DB value wins over env; empty/whitespace row means “no override” (use .env fallback). */
    if (s.trim() !== "") return s;
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

/** Product default when DB + env yield no positive minutes (`0` / empty / invalid = unset). */
const RESOLVED_WALLET_SCAN_TTL_FALLBACK_MINUTES = 10;
const RESOLVED_WALLET_ASSIGNMENT_HOLD_FALLBACK_MINUTES = 30;

/**
 * `WALLET_SCAN_TTL_MINUTES`: app_settings (only if parsed integer > 0), else `env.walletScanTtlMinutes`
 * if > 0, else {@link RESOLVED_WALLET_SCAN_TTL_FALLBACK_MINUTES}.
 *
 * @returns {number}
 */
export function resolvedWalletScanTtlMinutes() {
  if (
    APP_SETTING_DEF_BY_KEY.has("WALLET_SCAN_TTL_MINUTES") &&
    hasDbOverride("WALLET_SCAN_TTL_MINUTES")
  ) {
    const raw = rawDbValue("WALLET_SCAN_TTL_MINUTES")?.trim() ?? "";
    if (raw !== "") {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const e = env.walletScanTtlMinutes;
  if (typeof e === "number" && Number.isFinite(e) && e > 0) return e;
  return RESOLVED_WALLET_SCAN_TTL_FALLBACK_MINUTES;
}

/**
 * `WALLET_ASSIGNMENT_HOLD_MINUTES`: app_settings (only if parsed integer > 0), else
 * `env.walletAssignmentHoldMinutes` if > 0, else {@link RESOLVED_WALLET_ASSIGNMENT_HOLD_FALLBACK_MINUTES}.
 *
 * @returns {number}
 */
export function resolvedWalletAssignmentHoldMinutes() {
  if (
    APP_SETTING_DEF_BY_KEY.has("WALLET_ASSIGNMENT_HOLD_MINUTES") &&
    hasDbOverride("WALLET_ASSIGNMENT_HOLD_MINUTES")
  ) {
    const raw = rawDbValue("WALLET_ASSIGNMENT_HOLD_MINUTES")?.trim() ?? "";
    if (raw !== "") {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const e = env.walletAssignmentHoldMinutes;
  if (typeof e === "number" && Number.isFinite(e) && e > 0) return e;
  return RESOLVED_WALLET_ASSIGNMENT_HOLD_FALLBACK_MINUTES;
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

/**
 * Upsert by business `key` respecting soft-delete (partial unique on active keys in DB).
 * @param {string} key
 * @param {string} value
 */
export async function upsertAppSettingKeyValue(key, value) {
  await detectAppSettingDeletedAtSupport();
  const scope = appSettingsClientHasDeletedAt
    ? { ...APP_SETTING_NOT_DELETED }
    : {};
  const active = await prisma.appSetting.findFirst({
    where: { key, ...scope },
    select: { id: true },
  });
  if (active) {
    await prisma.appSetting.update({
      where: { id: active.id },
      data: appSettingsClientHasDeletedAt
        ? { value, deletedAt: null }
        : { value },
    });
    return;
  }
  if (appSettingsClientHasDeletedAt) {
    const tomb = await prisma.appSetting.findFirst({
      where: { key, deletedAt: { not: null } },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (tomb) {
      await prisma.appSetting.update({
        where: { id: tomb.id },
        data: { value, deletedAt: null },
      });
      return;
    }
  }
  await prisma.appSetting.create({ data: { key, value } });
}

/**
 * @param {string} key
 */
export async function softDeleteAppSettingKey(key) {
  await detectAppSettingDeletedAtSupport();
  if (appSettingsClientHasDeletedAt) {
    await prisma.appSetting.updateMany({
      where: { key, ...APP_SETTING_NOT_DELETED },
      data: { deletedAt: new Date() },
    });
    return;
  }
  await prisma.appSetting.deleteMany({ where: { key } });
}

/** Legacy Admin keys (ms) → `WORKER_POLL_INTERVAL_SEC_*` (seconds). Idempotent. */
async function migrateLegacyWorkerPollIntervalKeys() {
  await detectAppSettingDeletedAtSupport();
  const scope = appSettingsClientHasDeletedAt
    ? { ...APP_SETTING_NOT_DELETED }
    : {};
  const pairs = [
    ["WORKER_POLL_INTERVAL_MS_ERC20", "WORKER_POLL_INTERVAL_SEC_ERC20"],
    ["WORKER_POLL_INTERVAL_MS_TRC20", "WORKER_POLL_INTERVAL_SEC_TRC20"],
  ];
  for (const [oldKey, newKey] of pairs) {
    const oldRow = await prisma.appSetting.findFirst({
      where: { key: oldKey },
      orderBy: { id: "desc" },
    });
    if (!oldRow?.value?.trim()) continue;
    const newActive = await prisma.appSetting.findFirst({
      where: { key: newKey, ...scope },
    });
    if (newActive?.value?.trim()) continue;
    const ms = parseInt(oldRow.value.trim(), 10);
    if (!Number.isFinite(ms) || ms < 1) continue;
    const sec = Math.max(1, Math.ceil(ms / 1000));
    await upsertAppSettingKeyValue(newKey, String(sec));
    await softDeleteAppSettingKey(oldKey);
  }
}

export async function loadAppSettingsFromDatabase() {
  await migrateLegacyWorkerPollIntervalKeys();
  await detectAppSettingDeletedAtSupport();
  const scope = appSettingsClientHasDeletedAt
    ? { ...APP_SETTING_NOT_DELETED }
    : {};
  const rows = await prisma.appSetting.findMany({ where: { ...scope } });
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
  if (def.type === "usdt6" && envValue?.trim()) {
    return atomicUsdt6ToDecimalDisplay(envValue);
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
    case "WORKER_POLL_INTERVAL_SEC_ERC20":
      return String(Math.max(1, Math.ceil(env.workerPollMsErc20 / 1000)));
    case "DEPOSIT_SCANNER_API_MAX_PER_SECOND_ERC20":
      return String(env.depositScannerApiMaxPerSecondErc20);
    case "WORKER_POLL_INTERVAL_SEC_TRC20":
      return String(Math.max(1, Math.ceil(env.workerPollMsTrc20 / 1000)));
    case "DEPOSIT_SCANNER_API_MAX_PER_SECOND_TRC20":
      return String(env.depositScannerApiMaxPerSecondTrc20);
    case "EVM_DEPOSIT_SCAN_MAX_BLOCKS_PER_TICK":
      return String(env.evmDepositScanMaxBlocksPerTick);
    case "WALLET_SCAN_TTL_MINUTES":
      return String(env.walletScanTtlMinutes);
    case "WALLET_ASSIGNMENT_HOLD_MINUTES":
      return String(env.walletAssignmentHoldMinutes);
    case "WALLET_POOL_HOLD_RELEASE_CRON_MINUTES":
      return String(env.walletPoolHoldReleaseCronMinutes);
    case "CHECKOUT_CREATED_EXPIRY_HOURS":
      return String(env.checkoutCreatedExpiryHours);
    case "CHECKOUT_EXPIRY_CRON_MINUTES":
      return String(env.checkoutExpiryCronMinutes);
    case "LATE_DEPOSIT_RECHECK_HOURS":
      return String(env.lateDepositRecheckHours);
    case "DEPOSIT_FULL_SCAN_INTERVAL_HOURS":
      return String(env.depositFullScanIntervalHours);
    case "WORKER_LOG_RAIL_COUNTS":
      return env.workerLogRailCounts;
    case "DEPOSIT_SCANNER_TRON_ONLY":
      return env.depositScannerTronOnly ? "true" : "false";
    case "ETHERSCAN_API_BASE":
      return env.etherscanApiBase ?? "";
    case "ETHERSCAN_API_KEY":
      return env.etherscanApiKey ?? "";
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
    case "SWEEP_MASTER_TRON":
      return env.sweepMasterTron ?? "";
    case "SWEEP_MASTER_USDT_ETH":
      return env.sweepMasterUsdtEth ?? "";
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
    case "CHAIN_ENABLED":
      return env.chainEnabledJson ?? "{}";
    default:
      return "";
  }
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
      if (key === "EVM_DEPOSIT_SCAN_MAX_BLOCKS_PER_TICK") {
        if (n < 1 || n > 50) {
          throw new Error(`${key}: must be between 1 and 50`);
        }
      }
      if (
        key === "WORKER_POLL_INTERVAL_SEC_ERC20" ||
        key === "WORKER_POLL_INTERVAL_SEC_TRC20"
      ) {
        if (n < 1) {
          throw new Error(`${key}: must be at least 1 second`);
        }
      }
      if (
        key === "DEPOSIT_SCANNER_API_MAX_PER_SECOND_ERC20" ||
        key === "DEPOSIT_SCANNER_API_MAX_PER_SECOND_TRC20"
      ) {
        if (n < 0) {
          throw new Error(`${key}: must be 0 (unlimited rail cap) or >= 1`);
        }
        if (n > 500) {
          throw new Error(`${key}: must be at most 500`);
        }
      }
      if (key === "CHECKOUT_EXPIRY_CRON_MINUTES") {
        if (n < 1 || n > 59) {
          throw new Error(`${key}: must be between 1 and 59`);
        }
      }
      if (key === "CHECKOUT_CREATED_EXPIRY_HOURS") {
        if (n < 1 || n > 8760) {
          throw new Error(`${key}: must be between 1 and 8760`);
        }
      }
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
    case "usdt6": {
      try {
        return parseAdminUsdtAmountToAtomicString(s);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${key}: ${msg}`);
      }
    }
    case "json": {
      const p = JSON.parse(s);
      if (p === null || typeof p !== "object" || Array.isArray(p)) {
        throw new Error(`${key}: JSON must be an object`);
      }
      if (key === "CHAIN_ENABLED") {
        return normalizeChainEnabledStoredObject(
          /** @type {Record<string, unknown>} */ (p),
        );
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
  if (def.type === "int" || def.type === "bigint" || def.type === "usdt6")
    return true;
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
    if (def.hideFromAdminList) continue;
    const raw = envFallbackString(def.key);
    if (!shouldWriteEnvValueToAppSettings(def, raw)) continue;
    try {
      let normalized;
      if (def.type === "usdt6") {
        const b = env.sweepTronUsdtMinAtomic;
        if (b < 1n) {
          throw new Error(
            "SWEEP_TRON_USDT_MIN_ATOMIC must be >= 1 (atomic unit)",
          );
        }
        normalized = b.toString();
      } else {
        normalized = validateStoredValue(def.key, raw);
      }
      ops.push({ key: def.key, value: normalized });
    } catch (e) {
      logger.warn("sync_app_settings_skip_invalid", {
        key: def.key,
        err: String(e),
      });
    }
  }

  if (ops.length > 0) {
    for (const op of ops) {
      await upsertAppSettingKeyValue(op.key, op.value);
    }
  }

  await loadAppSettingsFromDatabase();

  const considered = APP_SETTING_DEFINITIONS.filter(
    (d) => !d.hideFromAdminList,
  ).length;
  const skipped = considered - ops.length;
  return { upserted: ops.length, skipped };
}

/**
 * Admin GET payload.
 */
export function buildAppSettingsAdminList() {
  return APP_SETTING_DEFINITIONS.filter((d) => !d.hideFromAdminList).map(
    (def) => {
      const envVal = envFallbackString(def.key);
      const dbVal = hasDbOverride(def.key) ? rawDbValue(def.key) : null;
      const effective = hasDbOverride(def.key) ? String(dbVal ?? "") : envVal;
      let displayEffective = effective;
      if (def.sensitive) {
        /** DB override: round-trip in admin UI (plain text). `.env` only: never send secret to browser. */
        if (dbVal?.trim()) {
          displayEffective = String(dbVal);
        } else if (envVal?.trim()) {
          displayEffective = MASK;
        }
      }
      if (def.type === "json" && effective?.trim()) {
        try {
          displayEffective = JSON.stringify(JSON.parse(effective), null, 2);
        } catch {
          /* keep raw */
        }
      }
      if (def.type === "usdt6" && effective?.trim()) {
        displayEffective = atomicUsdt6ToDecimalDisplay(effective);
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
        help_text: def.helpText ?? "",
        /**
         * For Formik: sensitive values prefilled from DB so “Save” does not wipe them when other fields change.
         * Empty sensitive + DB row still means “remove override” on save. `.env`-only secrets stay out of the form.
         */
        form_initial: def.sensitive
          ? dbVal != null && String(dbVal).trim() !== ""
            ? String(dbVal)
            : ""
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
              : def.type === "usdt6"
                ? atomicUsdt6ToDecimalDisplay(
                    hasDbOverride(def.key) ? String(dbVal ?? "") : envVal,
                  )
                : hasDbOverride(def.key)
                  ? String(dbVal ?? "")
                  : envVal,
      };
    },
  );
}

/**
 * Applies admin UI save: every submitted field is written (upsert) or cleared (delete when empty).
 * Values that match `.env` are still stored in `app_settings` so the full form round-trips from DB.
 *
 * @param {Record<string, string | null | undefined>} patch
 */
export async function applyAppSettingsPatch(patch) {
  for (const k of Object.keys(patch)) {
    if (!APP_SETTING_DEF_BY_KEY.has(k)) {
      throw new Error(`Unknown setting key: ${k}`);
    }
  }

  /** @type {{ type: "delete" | "upsert", key: string, value?: string }[]} */
  const ops = [];

  for (const def of APP_SETTING_DEFINITIONS) {
    const key = def.key;
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;

    const raw = patch[key];
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
    ops.push({ type: "upsert", key, value: normalized });
  }

  if (ops.length > 0) {
    for (const op of ops) {
      if (op.type === "delete") {
        await softDeleteAppSettingKey(op.key);
      } else {
        await upsertAppSettingKeyValue(op.key, op.value ?? "");
      }
    }
  }

  await loadAppSettingsFromDatabase();

  const chainEnabledTouched = ops.some((o) => o.key === "CHAIN_ENABLED");
  if (chainEnabledTouched) {
    const prune = await pruneMerchantsAfterSupportedChainsChange();
    logger.info("app_settings CHAIN_ENABLED patch: pruned merchants", prune);
  }
}
