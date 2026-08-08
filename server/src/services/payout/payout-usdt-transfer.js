import { Chain } from "@prisma/client";
import { Contract, JsonRpcProvider, Wallet as EthersWallet, ethers } from "ethers";
import { utils as tronUtils } from "tronweb";
import { chainToRpcUrl, chainToStaticNetwork } from "../../config/chains.js";
import { logger } from "../../lib/logger.js";
import {
  acquireOutboundRpcSlot,
  evmRpcBudgetKey,
} from "../../lib/network-rpc-rate-limit.js";
import {
  getMerchantTrxSweepFunderPrivateKeyHex,
  normalizeTronPrivateKeyHex,
} from "../../lib/merchant-trx-funder.js";
import { env } from "../../config/env.js";
import {
  createTronWebFromPrivateKeyHex,
  estimateTrxSunRequiredForTrc20Transfer,
  pickUsdtTrc20Contract,
} from "../sweep/tron-usdt-sweep.js";
import {
  sendTrxNativeTopUpFromPrivateKey,
  TRX_TOPUP_SETTLE_MS,
  TRX_TOPUP_SEND_BUFFER_SUN,
} from "../sweep/tron-trx-topup.js";
import { pickUsdtTokenAddress } from "../sweep/evm-usdt-sweep.js";

const ERC20_MIN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

/**
 * @param {unknown} raw
 * @returns {bigint}
 */
function rawBalanceToBigInt(raw) {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw))
    return BigInt(Math.trunc(raw));
  if (raw && typeof raw === "object" && "_hex" in raw) {
    return BigInt(/** @type {{ _hex: string }} */ (raw)._hex);
  }
  if (raw && typeof raw === "object" && typeof raw.toString === "function") {
    const s = String(raw.toString()).trim();
    if (/^\d+$/.test(s)) return BigInt(s);
  }
  const s = String(raw ?? "").trim();
  if (/^\d+$/.test(s)) return BigInt(s);
  return 0n;
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
 * Exact USDT·TRC20 amount transfer from a hex private key.
 *
 * @param {{
 *   privateKeyHex: string,
 *   fromAddress: string,
 *   toAddress: string,
 *   amountAtomic: bigint,
 *   merchantIdForTrxTopup?: number | null,
 *   allowPlatformTrxFunder?: boolean,
 * }} p
 * @returns {Promise<{ ok: true, tx_hash: string, from_address: string, to_address: string, amount_atomic: string } | { ok: false, error: string, detail?: string }>}
 */
export async function transferTronUsdtAmount(p) {
  let pkHex;
  try {
    pkHex = normalizeTronPrivateKeyHex(p.privateKeyHex);
  } catch {
    return { ok: false, error: "INVALID_FROM_PRIVATE_KEY" };
  }

  let contractAddr;
  try {
    contractAddr = pickUsdtTrc20Contract();
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
  if (tronAddrEq(p.fromAddress, p.toAddress)) {
    return { ok: false, error: "SOURCE_IS_DESTINATION" };
  }

  const amount = p.amountAtomic;
  if (amount <= 0n) {
    return { ok: false, error: "INVALID_AMOUNT" };
  }

  const contract = tw.contract(
    [
      {
        constant: true,
        inputs: [{ name: "_owner", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "balance", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
      {
        constant: false,
        inputs: [
          { name: "_to", type: "address" },
          { name: "_value", type: "uint256" },
        ],
        name: "transfer",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ],
    contractAddr,
  );

  await acquireOutboundRpcSlot("TRON");
  const balRaw = await contract.balanceOf(p.fromAddress).call();
  const bal = rawBalanceToBigInt(balRaw);
  if (bal < amount) {
    return {
      ok: false,
      error: "INSUFFICIENT_USDT_ON_CHAIN",
      detail: `need ${amount} have ${bal}`,
    };
  }

  let neededTrxSun = await estimateTrxSunRequiredForTrc20Transfer(
    tw,
    p.fromAddress,
    contractAddr,
    p.toAddress,
    amount,
  );

  await acquireOutboundRpcSlot("TRON");
  let trxSun = BigInt(await tw.trx.getBalance(p.fromAddress));

  for (let attempt = 0; trxSun < neededTrxSun && attempt < 4; attempt += 1) {
    let funderPk = null;
    if (p.merchantIdForTrxTopup != null) {
      funderPk = await getMerchantTrxSweepFunderPrivateKeyHex(p.merchantIdForTrxTopup);
    }
    if (!funderPk && p.allowPlatformTrxFunder && env.sweepTrxFunderPrivateKey) {
      try {
        funderPk = normalizeTronPrivateKeyHex(env.sweepTrxFunderPrivateKey);
      } catch {
        funderPk = null;
      }
    }
    if (!funderPk) {
      return {
        ok: false,
        error: "TRX_FUNDER_REQUIRED",
        detail:
          "From-address needs TRX for fees. Configure merchant TRX funder or SWEEP_TRX_FUNDER_PRIVATE_KEY.",
      };
    }
    const gap = neededTrxSun - trxSun;
    const sendSun = gap + TRX_TOPUP_SEND_BUFFER_SUN;
    const top = await sendTrxNativeTopUpFromPrivateKey(p.fromAddress, sendSun, funderPk);
    if (!top.ok) {
      return {
        ok: false,
        error: top.error,
        detail: top.detail ?? "TRX top-up failed",
      };
    }
    await new Promise((r) => setTimeout(r, TRX_TOPUP_SETTLE_MS));
    await acquireOutboundRpcSlot("TRON");
    trxSun = BigInt(await tw.trx.getBalance(p.fromAddress));
    neededTrxSun = await estimateTrxSunRequiredForTrc20Transfer(
      tw,
      p.fromAddress,
      contractAddr,
      p.toAddress,
      amount,
    );
  }

  if (trxSun < neededTrxSun) {
    return {
      ok: false,
      error: "INSUFFICIENT_TRX_FOR_FEE",
      detail: `Need ~${neededTrxSun} sun; have ${trxSun}`,
    };
  }

  await acquireOutboundRpcSlot("TRON");
  let txId;
  try {
    txId = await contract.transfer(p.toAddress, amount.toString()).send({
      feeLimit: 150_000_000,
      shouldPollResponse: true,
    });
  } catch (e) {
    logger.error("payout tron usdt transfer failed", { err: String(e) });
    return { ok: false, error: "TRANSFER_FAILED", detail: String(e) };
  }

  return {
    ok: true,
    tx_hash: typeof txId === "string" ? txId : String(txId),
    from_address: p.fromAddress,
    to_address: p.toAddress,
    amount_atomic: amount.toString(),
  };
}

/**
 * Exact USDT·ERC20 amount transfer from a hex private key.
 *
 * @param {{
 *   privateKeyHex: string,
 *   fromAddress: string,
 *   toAddress: string,
 *   amountAtomic: bigint,
 * }} p
 * @returns {Promise<{ ok: true, tx_hash: string, from_address: string, to_address: string, amount_atomic: string } | { ok: false, error: string, detail?: string }>}
 */
export async function transferEvmUsdtAmount(p) {
  const pk = String(p.privateKeyHex ?? "").trim();
  if (!pk) return { ok: false, error: "INVALID_FROM_PRIVATE_KEY" };

  let signer;
  try {
    signer = new EthersWallet(pk.startsWith("0x") ? pk : `0x${pk}`);
  } catch {
    return { ok: false, error: "INVALID_FROM_PRIVATE_KEY" };
  }

  let fromNorm;
  let toNorm;
  try {
    fromNorm = ethers.getAddress(p.fromAddress);
    toNorm = ethers.getAddress(p.toAddress);
  } catch {
    return { ok: false, error: "INVALID_ADDRESS" };
  }

  if (signer.address.toLowerCase() !== fromNorm.toLowerCase()) {
    return {
      ok: false,
      error: "DERIVED_ADDRESS_MISMATCH",
      detail: `key→${signer.address} vs from→${fromNorm}`,
    };
  }
  if (fromNorm.toLowerCase() === toNorm.toLowerCase()) {
    return { ok: false, error: "SOURCE_IS_DESTINATION" };
  }

  const amount = p.amountAtomic;
  if (amount <= 0n) return { ok: false, error: "INVALID_AMOUNT" };

  const tokenAddr = pickUsdtTokenAddress(Chain.ETH);
  if (!tokenAddr) return { ok: false, error: "CONFIG", detail: "No USDT ERC20 contract" };

  const staticNet = chainToStaticNetwork(Chain.ETH);
  const provider = new JsonRpcProvider(chainToRpcUrl(Chain.ETH), staticNet, {
    staticNetwork: true,
  });
  const budgetKey = evmRpcBudgetKey(Chain.ETH);
  const connected = signer.connect(provider);
  const usdt = new Contract(tokenAddr, ERC20_MIN_ABI, connected);

  await acquireOutboundRpcSlot(budgetKey);
  const bal = await usdt.balanceOf(fromNorm);
  if (bal < amount) {
    return {
      ok: false,
      error: "INSUFFICIENT_USDT_ON_CHAIN",
      detail: `need ${amount} have ${bal}`,
    };
  }

  await acquireOutboundRpcSlot(budgetKey);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  if (gasPrice <= 0n) {
    return { ok: false, error: "NO_GAS_PRICE" };
  }

  await acquireOutboundRpcSlot(budgetKey);
  let gasLimit;
  try {
    gasLimit = await usdt.transfer.estimateGas(toNorm, amount);
  } catch (e) {
    gasLimit = 120_000n;
    logger.warn("payout evm estimateGas failed, using default", { err: String(e) });
  }

  const gasBuffer = (gasLimit * gasPrice * 13n) / 10n;
  await acquireOutboundRpcSlot(budgetKey);
  const nativeBal = await provider.getBalance(fromNorm);
  if (nativeBal < gasBuffer) {
    return {
      ok: false,
      error: "INSUFFICIENT_NATIVE_FOR_GAS",
      detail: `Need ~${gasBuffer.toString()} wei; have ${nativeBal.toString()}`,
    };
  }

  let tx;
  try {
    await acquireOutboundRpcSlot(budgetKey);
    tx = await usdt.transfer(toNorm, amount);
    await acquireOutboundRpcSlot(budgetKey);
    const receipt = await tx.wait(1);
    if (!receipt?.status) {
      return { ok: false, error: "TX_REVERTED" };
    }
  } catch (e) {
    logger.error("payout evm usdt transfer failed", { err: String(e) });
    return { ok: false, error: "TRANSFER_FAILED", detail: String(e) };
  }

  return {
    ok: true,
    tx_hash: tx.hash,
    from_address: fromNorm,
    to_address: toNorm,
    amount_atomic: amount.toString(),
  };
}
