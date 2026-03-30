import { parseJsonEnv } from "./env.js";
import { getResolvedString } from "../lib/app-settings-runtime.js";

const DEFAULT_TRC20_USDT = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { symbol: "USDT", decimals: 6 },
};

const DEFAULT_TON_JETTON_USDT = {
  EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs: {
    symbol: "USDT",
    decimals: 6,
  },
  "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe": {
    symbol: "USDT",
    decimals: 6,
  },
};

/**
 * @returns {Record<string, unknown>}
 */
export function getErc20Contracts() {
  const raw = getResolvedString("ERC20_CONTRACTS", () => {
    const e = process.env.ERC20_CONTRACTS?.trim();
    return e && e.length > 0 ? e : "{}";
  });
  return parseJsonEnv(raw, {});
}

/**
 * @returns {Record<string, { symbol: string, decimals: number }>}
 */
export function getTrc20Contracts() {
  const raw = getResolvedString("TRC20_CONTRACTS", () => {
    const e = process.env.TRC20_CONTRACTS?.trim();
    return e && e.length > 0 ? e : "{}";
  });
  const fromEnv = parseJsonEnv(raw, {});
  return { ...DEFAULT_TRC20_USDT, ...fromEnv };
}

/**
 * @returns {Record<string, { symbol: string, decimals: number }>}
 */
export function getTonJettonContracts() {
  const raw = getResolvedString("TON_JETTON_CONTRACTS", () => {
    const e = process.env.TON_JETTON_CONTRACTS?.trim();
    return e && e.length > 0 ? e : "{}";
  });
  const fromEnv = parseJsonEnv(raw, {});
  return { ...DEFAULT_TON_JETTON_USDT, ...fromEnv };
}
