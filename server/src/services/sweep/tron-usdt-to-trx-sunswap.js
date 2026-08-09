/**
 * SunSwap V2: sell USDT·TRC20 for native TRX on the same wallet (fee top-up).
 */
import { utils as tronUtils } from "tronweb";
import { logger } from "../../lib/logger.js";
import { acquireOutboundRpcSlot } from "../../lib/network-rpc-rate-limit.js";
import {
  createTronWebFromPrivateKeyHex,
  pickUsdtTrc20Contract,
} from "./tron-usdt-sweep.js";
import {
  normalizeTronPrivateKeyHex,
} from "../../lib/merchant-trx-funder.js";
import { TRX_TOPUP_SETTLE_MS } from "./tron-trx-topup.js";

/** SunSwap V2 router (UniswapV2Router02 fork) — TRON mainnet. */
export const SUNSWAP_V2_ROUTER = "TNJVzGqKBWkJxJB5XYSqGAwUTV15U24pPq";

/** Wrapped TRX (WTRX) — TRON mainnet (SunSwap / official WTRX). */
export const WTRX_TRC20 = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";

/** Default max slippage vs `getAmountsIn` quote (basis points). */
const DEFAULT_SLIPPAGE_BPS = 200n;

const TRC20_APPROVE_ABI = [
  {
    constant: true,
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "remaining", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "_spender", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

const ROUTER_ABI = [
  {
    constant: true,
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    name: "getAmountsIn",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    name: "swapExactTokensForETH",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/**
 * @param {unknown} raw
 * @returns {bigint}
 */
function rawToBigInt(raw) {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw))
    return BigInt(Math.trunc(raw));
  if (Array.isArray(raw) && raw.length > 0) return rawToBigInt(raw[0]);
  if (raw && typeof raw === "object" && "_hex" in raw) {
    return BigInt(/** @type {{ _hex: string }} */ (raw)._hex);
  }
  if (raw && typeof raw === "object" && typeof raw.toString === "function") {
    const s = String(raw.toString()).trim();
    if (/^\d+$/.test(s)) return BigInt(s);
  }
  const s = String(raw ?? "").trim();
  if (/^\d+$/.test(s)) return BigInt(s);
  if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s);
  throw new Error("UNEXPECTED_UINT_FORMAT");
}

/**
 * @param {string} a
 * @param {string} b
 */
function tronAddrEq(a, b) {
  try {
    return tronUtils.address.toHex(a) === tronUtils.address.toHex(b);
  } catch {
    return false;
  }
}

/**
 * Sell USDT on `fromAddress` for at least `trxOutSun` native TRX (same wallet).
 *
 * @param {{
 *   privateKeyHex: string,
 *   fromAddress: string,
 *   trxOutSun: bigint,
 *   reserveUsdtAtomic?: bigint | null,
 *   slippageBps?: bigint,
 * }} p
 * @returns {Promise<
 *   | { ok: true, tx_hash: string, usdt_in_atomic: string, trx_out_sun: string }
 *   | { ok: false, error: string, detail?: string }
 * >}
 */
export async function swapUsdtForTrxOnWallet(p) {
  let pkHex;
  try {
    pkHex = normalizeTronPrivateKeyHex(p.privateKeyHex);
  } catch {
    return { ok: false, error: "INVALID_FROM_PRIVATE_KEY" };
  }

  const trxOut = p.trxOutSun;
  if (typeof trxOut !== "bigint" || trxOut <= 0n) {
    return { ok: false, error: "INVALID_TRX_OUT", detail: "trxOutSun must be > 0" };
  }

  let usdtAddr;
  try {
    usdtAddr = pickUsdtTrc20Contract();
  } catch (e) {
    return { ok: false, error: "CONFIG", detail: String(e) };
  }

  const tw = createTronWebFromPrivateKeyHex(pkHex);
  const derived = tw.defaultAddress?.base58;
  if (typeof derived !== "string" || !derived.trim()) {
    return { ok: false, error: "TRONWEB_ADDRESS_NOT_READY" };
  }
  if (!tronAddrEq(derived, p.fromAddress)) {
    return {
      ok: false,
      error: "DERIVED_ADDRESS_MISMATCH",
      detail: `key→${derived} vs from→${p.fromAddress}`,
    };
  }

  await acquireOutboundRpcSlot("TRON");
  const trxBefore = BigInt(await tw.trx.getBalance(p.fromAddress));
  if (trxBefore <= 0n) {
    return {
      ok: false,
      error: "SUNSWAP_NEEDS_TRX_DUST",
      detail:
        "Wallet has 0 TRX; SunSwap approve/swap cannot broadcast. Leave a small TRX balance on the payout treasury or configure the TRX funder private key.",
    };
  }

  const usdt = tw.contract(TRC20_APPROVE_ABI, usdtAddr);
  const router = tw.contract(ROUTER_ABI, SUNSWAP_V2_ROUTER);
  const path = [usdtAddr, WTRX_TRC20];

  let amountsIn;
  try {
    await acquireOutboundRpcSlot("TRON");
    const quoted = await router.getAmountsIn(trxOut.toString(), path).call();
    // TronWeb may return array-like or object with numeric keys
    if (Array.isArray(quoted)) {
      amountsIn = quoted.map((x) => rawToBigInt(x));
    } else if (quoted && typeof quoted === "object") {
      amountsIn = [rawToBigInt(quoted[0]), rawToBigInt(quoted[1] ?? quoted[0])];
    } else {
      amountsIn = [rawToBigInt(quoted)];
    }
  } catch (e) {
    logger.warn("sunswap_get_amounts_in_failed", { err: String(e) });
    return {
      ok: false,
      error: "SUNSWAP_QUOTE_FAILED",
      detail: String(e).slice(0, 400),
    };
  }

  const usdtIn = amountsIn[0];
  if (usdtIn <= 0n) {
    return { ok: false, error: "SUNSWAP_QUOTE_FAILED", detail: "amountIn=0" };
  }

  // Pad quote slightly so minOut stays reachable after pool move
  const usdtInPadded = (usdtIn * 10050n) / 10000n;
  const slip = p.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const amountOutMin = (trxOut * (10000n - slip)) / 10000n;

  await acquireOutboundRpcSlot("TRON");
  const balRaw = await usdt.balanceOf(p.fromAddress).call();
  const usdtBal = rawToBigInt(balRaw);
  const reserve =
    typeof p.reserveUsdtAtomic === "bigint" && p.reserveUsdtAtomic > 0n
      ? p.reserveUsdtAtomic
      : 0n;
  if (usdtBal < usdtInPadded + reserve) {
    return {
      ok: false,
      error: "SUNSWAP_INSUFFICIENT_USDT",
      detail: `need ${usdtInPadded} USDT atomic for fees (+ reserve ${reserve}); have ${usdtBal}`,
    };
  }

  await acquireOutboundRpcSlot("TRON");
  let allowance = 0n;
  try {
    allowance = rawToBigInt(
      await usdt.allowance(p.fromAddress, SUNSWAP_V2_ROUTER).call(),
    );
  } catch {
    allowance = 0n;
  }

  if (allowance < usdtInPadded) {
    try {
      await acquireOutboundRpcSlot("TRON");
      await usdt.approve(SUNSWAP_V2_ROUTER, usdtInPadded.toString()).send({
        feeLimit: 100_000_000,
        shouldPollResponse: true,
      });
      await new Promise((r) => setTimeout(r, TRX_TOPUP_SETTLE_MS));
    } catch (e) {
      logger.error("sunswap_usdt_approve_failed", { err: String(e) });
      return {
        ok: false,
        error: "SUNSWAP_APPROVE_FAILED",
        detail: String(e).slice(0, 400),
      };
    }
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;
  let txId;
  try {
    await acquireOutboundRpcSlot("TRON");
    txId = await router
      .swapExactTokensForETH(
        usdtInPadded.toString(),
        amountOutMin.toString(),
        path,
        p.fromAddress,
        deadline,
      )
      .send({
        feeLimit: 150_000_000,
        shouldPollResponse: true,
      });
  } catch (e) {
    logger.error("sunswap_usdt_to_trx_failed", { err: String(e) });
    return {
      ok: false,
      error: "SUNSWAP_SWAP_FAILED",
      detail: String(e).slice(0, 500),
    };
  }

  await new Promise((r) => setTimeout(r, TRX_TOPUP_SETTLE_MS));

  return {
    ok: true,
    tx_hash: typeof txId === "string" ? txId : String(txId),
    usdt_in_atomic: usdtInPadded.toString(),
    trx_out_sun: trxOut.toString(),
  };
}
