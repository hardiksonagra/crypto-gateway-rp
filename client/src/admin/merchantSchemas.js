import * as yup from "yup";

export const CHAIN_VALUES = [
  "ETH",
  "BNB",
  "POLYGON",
  "ARBITRUM",
  "OPTIMISM",
  "TRON",
  "BTC",
  "TON",
];

export const EVM_CHAIN_VALUES = ["ETH", "BNB", "POLYGON", "ARBITRUM", "OPTIMISM"];

const defaultChainsField = yup
  .array()
  .of(yup.string().oneOf([...CHAIN_VALUES], "Invalid chain"))
  .min(1, "Select at least one chain");

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

export const merchantCreateSchema = yup.object({
  email: yup.string().trim().required("Email is required").email("Invalid email"),
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
  default_chains: defaultChainsField,
  callback_url: optionalHttpsUrl,
});

export const merchantEditSchema = yup.object({
  display_name: yup
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  default_chains: defaultChainsField,
  callback_url: optionalHttpsUrl.nullable(),
  password: yup
    .string()
    .transform((v) => emptyToUndef(v))
    .optional()
    .min(8, "Password must be at least 8 characters"),
  regenerate_api_key: yup.boolean().required(),
});

export const merchantFilterSchema = yup.object({
  search: yup.string(),
  active: yup.string().oneOf(["", "true", "false"]),
});

const chainFilterField = yup.string().oneOf(["", ...CHAIN_VALUES], "Pick a chain");

export const adminUsersFilterSchema = yup.object({
  q: yup.string(),
  merchant_id: yup.string(),
  created_from: yup.string(),
  created_to: yup.string(),
});

export const adminTransactionsFilterSchema = yup.object({
  merchant_id: yup.string(),
  chain: chainFilterField,
  status: yup.string().oneOf(["", "pending", "success", "failed"]),
  token_symbol: yup.string(),
  address: yup.string(),
});

export const adminWithdrawalsFilterSchema = yup.object({
  merchant_id: yup.string(),
  chain: chainFilterField,
  status: yup.string().oneOf(["", "pending", "processing", "completed", "failed"]),
  token_symbol: yup.string(),
  to_address: yup.string(),
});

export const merchantUsersFilterSchema = yup.object({
  q: yup.string(),
});

export const merchantTransactionsFilterSchema = yup.object({
  chain: chainFilterField,
  status: yup.string().oneOf(["", "pending", "success", "failed"]),
  token_symbol: yup.string(),
  external_user_id: yup.string(),
});

export const merchantWithdrawalsListFilterSchema = yup.object({
  chain: chainFilterField,
  status: yup.string().oneOf(["", "pending", "processing", "completed", "failed"]),
  token_symbol: yup.string(),
  to_address: yup.string(),
});

export const loginSchema = yup.object({
  email: yup.string().trim().required("Email is required").email("Invalid email"),
  password: yup.string().required("Password is required"),
});

export const merchantSettingsSchema = yup.object({
  callback_url: optionalHttpsUrl.nullable(),
  default_chains: defaultChainsField,
});

export const merchantWithdrawSchema = yup.object({
  chain: yup
    .string()
    .oneOf([...EVM_CHAIN_VALUES], "Pick an EVM chain")
    .required("Chain is required"),
  to_address: yup
    .string()
    .trim()
    .required("Address is required")
    .matches(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address (0x + 40 hex)"),
  amount: yup
    .string()
    .trim()
    .required("Amount is required")
    .test("pos-int", "Enter a positive whole-number amount (e.g. wei)", (v) => {
      try {
        const b = BigInt(v);
        return b > 0n;
      } catch {
        return false;
      }
    }),
});
