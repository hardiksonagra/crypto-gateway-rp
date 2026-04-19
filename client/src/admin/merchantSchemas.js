import * as yup from "yup";
import {
  ALL_DEPOSIT_RAIL_OPTIONS,
  DEPOSIT_RAIL_OPTIONS,
  MERCHANT_SETTINGS_CHAIN_VALUES,
} from "./depositRailOptions.js";

/** All chains (filters, history). */
export const CHAIN_VALUES = ["TRON", "SOLANA", "ETH", "BNB", "TON"];

/**
 * @param {string[] | undefined | null} allowedChains
 * @returns {string[]}
 */
function effectiveMerchantChainAllowList(allowedChains) {
  if (Array.isArray(allowedChains) && allowedChains.length > 0) return allowedChains;
  return [...MERCHANT_SETTINGS_CHAIN_VALUES];
}

/**
 * @param {string[] | undefined | null} allowedChains
 */
function makeDefaultChainsSchema(allowedChains) {
  const chains = effectiveMerchantChainAllowList(allowedChains);
  return yup
    .array()
    .of(yup.string().oneOf([...chains], "Invalid chain"))
    .min(1, "Select at least one chain");
}

/**
 * @param {string[] | undefined | null} allowedChains
 * @param {boolean} [fullProductRails] Admin merchant create/edit: validate against full gateway rail catalog (ERC20, BEP20, …).
 */
function makeSupportedDepositRailsSchema(allowedChains, fullProductRails = false) {
  const chains = effectiveMerchantChainAllowList(allowedChains);
  const source = fullProductRails ? ALL_DEPOSIT_RAIL_OPTIONS : DEPOSIT_RAIL_OPTIONS;
  const railOpts = source.filter((o) => chains.includes(o.chain));
  const railKeys = railOpts.map((o) => o.key);
  return yup
    .array()
    .of(yup.string().oneOf([...railKeys], "Invalid currency / network"))
    .min(1, "Select at least one currency / network")
    .test(
      "rail-chains",
      "Each selected rail must match supported chains",
      function railChains(rails) {
        const dc = this.parent.default_chains;
        if (!Array.isArray(rails) || !Array.isArray(dc)) return true;
        return rails.every((key) => {
          const opt = railOpts.find((o) => o.key === key);
          return Boolean(opt && dc.includes(opt.chain));
        });
      },
    );
}

const emptyToUndef = (v) => (v === "" || v === null ? undefined : v);

const optionalHttpsUrl = yup
  .string()
  .trim()
  .transform((v) => emptyToUndef(v))
  .optional()
  .test("https-url", "Use http:// or https:// URL", (v) => {
    if (v == null || v === "") return true;
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  });

const feePercentField = yup
  .number()
  .transform((v, o) => {
    const raw = o.originalValue;
    if (raw === "" || raw == null) return 0;
    return v;
  })
  .min(0, "Min 0%")
  .max(100, "Max 100%")
  .required();

const mdrPercentField = feePercentField.test(
  "fee-sum-mdr",
  "MDR + settlement cannot exceed 100%",
  function mdrSum(v) {
    const s = Number(this.parent.settlement_rate_percent) || 0;
    return (Number(v) || 0) + s <= 100;
  },
);

const settlementRatePercentField = feePercentField.test(
  "fee-sum-settlement",
  "MDR + settlement cannot exceed 100%",
  function settlementSum(v) {
    const m = Number(this.parent.mdr_percent) || 0;
    return m + (Number(v) || 0) <= 100;
  },
);

/** Minimum settlement in token units (e.g. 3000 = three thousand tokens), not chain raw integer; empty → "0". */
const minSettlementAmountField = yup
  .string()
  .trim()
  .transform((v) => (v === "" || v == null ? "0" : v))
  .test(
    "human-tokens",
    "Use a non-negative token amount (e.g. 3000 or 0.002), digits and at most one decimal point",
    (v) => {
      const s = String(v ?? "0");
      if (s === "0" || /^0\.0*$/.test(s)) return true;
      if (!/^(?:\d+\.?\d*|\.\d+)$/.test(s)) return false;
      const dot = s.indexOf(".");
      const frac = dot === -1 ? "" : s.slice(dot + 1);
      return frac.length <= 36;
    },
  )
  .required();

const settlementPeriodDaysField = yup
  .number()
  .transform((v, o) => {
    const raw = o.originalValue;
    if (raw === "" || raw == null) return 0;
    return v;
  })
  .integer("Use whole days only (e.g. 1, 2, 3)")
  .min(0, "Min 0 days")
  .max(3650, "Max 3650 days")
  .required();

/**
 * @param {string[] | undefined | null} allowedChains Platform-enabled merchant chains; omit to use full product list.
 */
export function buildMerchantCreateSchema(allowedChains) {
  return yup.object({
    email: yup
      .string()
      .trim()
      .required("Email is required")
      .email("Invalid email"),
    password: yup
      .string()
      .transform((v) => emptyToUndef(v))
      .optional()
      .min(8, "Password must be at least 8 characters"),
    display_name: yup
      .string()
      .trim()
      .transform((v) => (v === "" ? undefined : v))
      .optional(),
    default_chains: makeDefaultChainsSchema(allowedChains),
    supported_deposit_rails: makeSupportedDepositRailsSchema(allowedChains, true),
    callback_url: optionalHttpsUrl,
    mdr_percent: mdrPercentField,
    settlement_rate_percent: settlementRatePercentField,
    min_settlement_amount: minSettlementAmountField,
    settlement_period_days: settlementPeriodDaysField,
    live_gateway_enabled: yup.boolean().required(),
    sandbox_gateway_enabled: yup.boolean().required(),
  });
}

/**
 * @param {string[] | undefined | null} allowedChains
 */
export function buildMerchantEditSchema(allowedChains) {
  return yup.object({
    display_name: yup
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    default_chains: makeDefaultChainsSchema(allowedChains),
    supported_deposit_rails: makeSupportedDepositRailsSchema(allowedChains, true),
    callback_url: optionalHttpsUrl.nullable(),
    password: yup
      .string()
      .transform((v) => emptyToUndef(v))
      .optional()
      .min(8, "Password must be at least 8 characters"),
    regenerate_api_key: yup.boolean().required(),
    mdr_percent: mdrPercentField,
    settlement_rate_percent: settlementRatePercentField,
    min_settlement_amount: minSettlementAmountField,
    settlement_period_days: settlementPeriodDaysField,
    live_gateway_enabled: yup.boolean().required(),
    sandbox_gateway_enabled: yup.boolean().required(),
  });
}

export const merchantCreateSchema = buildMerchantCreateSchema(undefined);
export const merchantEditSchema = buildMerchantEditSchema(undefined);

export const merchantFilterSchema = yup.object({
  search: yup.string(),
  active: yup.string().oneOf(["", "true", "false"]),
  list_scope: yup.string().oneOf(["", "all", "deleted"]),
});

const chainFilterField = yup
  .string()
  .oneOf(["", ...CHAIN_VALUES], "Pick a chain");

export const adminUsersFilterSchema = yup.object({
  q: yup.string(),
  merchant_id: yup.string(),
  created_from: yup.string(),
  created_to: yup.string(),
});

export const adminAuditLogsFilterSchema = yup.object({
  merchant_id: yup.string(),
  source: yup.string(),
  action: yup.string(),
  created_from: yup.string(),
  created_to: yup.string(),
});

export const adminPanelAuditLogsFilterSchema = yup.object({
  panel: yup.string().oneOf(["", "admin", "merchant"]),
  merchant_id: yup.string(),
  actor_id: yup.string(),
  path: yup.string(),
  created_from: yup.string(),
  created_to: yup.string(),
});

export const adminTransactionsFilterSchema = yup.object({
  merchant_id: yup.string(),
  external_user_id: yup.string(),
  transaction_id: yup.string(),
  chain: chainFilterField,
  status: yup
    .string()
    .oneOf(["", "pending", "success", "failed", "underpaid"]),
  token_symbol: yup.string(),
  address: yup.string(),
});

/** Filters for transactions on merchant detail (merchant id is fixed in the page). */
export const merchantDetailTransactionsFilterSchema = yup.object({
  chain: chainFilterField,
  status: yup
    .string()
    .oneOf(["", "pending", "success", "failed", "underpaid"]),
  token_symbol: yup.string(),
  address: yup.string(),
  transaction_id: yup.string(),
});

/** Filters for wallets on merchant detail (merchant id is fixed in the page). */
export const merchantDetailWalletsFilterSchema = yup.object({
  chain: chainFilterField,
  address: yup.string(),
  currency: yup.string(),
  network: yup.string(),
  q: yup.string(),
  created_from: yup.string(),
  created_to: yup.string(),
});

/** Admin “All wallets” list filters. */
export const adminWalletsFilterSchema = yup.object({
  q: yup.string(),
  merchant_id: yup.string(),
  chain: chainFilterField,
  currency: yup.string(),
  network: yup.string(),
  pageSize: yup.string().oneOf(["10", "20", "50", "100"]),
});

/** Filters for end users on merchant detail (merchant id is fixed in the page). */
export const merchantDetailUsersFilterSchema = yup.object({
  q: yup.string(),
  created_from: yup.string(),
  created_to: yup.string(),
});

export const merchantUsersFilterSchema = yup.object({
  q: yup.string(),
});

export const merchantWalletsFilterSchema = yup.object({
  q: yup.string(),
});

export const merchantTransactionsFilterSchema = yup.object({
  chain: chainFilterField,
  status: yup
    .string()
    .oneOf(["", "pending", "success", "failed", "underpaid"]),
  token_symbol: yup.string(),
  external_user_id: yup.string(),
  transaction_id: yup.string(),
});

export const loginSchema = yup.object({
  email: yup
    .string()
    .trim()
    .required("Email is required")
    .email("Invalid email"),
  password: yup.string().required("Password is required"),
});

/**
 * @param {string[] | undefined | null} allowedChains
 * @param {boolean} [fullProductRails] Gateway & webhooks (merchant portal): full rail catalog vs VITE-narrowed portal list.
 */
export function buildMerchantSettingsSchema(allowedChains, fullProductRails = false) {
  return yup.object({
    callback_url: optionalHttpsUrl.nullable(),
    default_chains: makeDefaultChainsSchema(allowedChains),
    supported_deposit_rails: makeSupportedDepositRailsSchema(allowedChains, fullProductRails),
  });
}

export const merchantSettingsSchema = buildMerchantSettingsSchema(undefined, false);

/** Filter admin settlement list + pending batch preview (merchant login email). */
export const adminSettlementsFilterSchema = yup.object({
  merchant_email: yup
    .string()
    .trim()
    .required("Merchant email is required")
    .email("Enter a valid email"),
});
