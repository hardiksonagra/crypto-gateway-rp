import { Chain } from "@prisma/client";
import { Contract, HDNodeWallet, JsonRpcProvider, ethers } from "ethers";
import { getErc20Contracts } from "../../config/env.js";
import { getMerchantWalletMnemonic } from "../../lib/merchant-mnemonic.js";
import {
  resolveMerchantRailSweepFromSettings,
  USDT_ERC20_RAIL_KEY,
} from "../../lib/merchant-auto-swap-settings.js";
import { re } from "../../config/runtime-env.js";
import { chainToRpcUrl, chainToStaticNetwork } from "../../config/chains.js";
import { parseWalletDbId } from "../../lib/parse-wallet-db-id.js";
import { ACTIVE } from "../../lib/active-row.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import {
  acquireOutboundRpcSlot,
  evmRpcBudgetKey,
} from "../../lib/network-rpc-rate-limit.js";

const ERC20_MIN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const DEFAULT_USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

const EXPECTED_NETWORK_ETH = "ERC20";

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {string | null}
 */
export function pickUsdtTokenAddress(chain) {
  if (chain !== Chain.ETH) return null;
  const raw = getErc20Contracts()[Chain.ETH] ?? {};
  for (const [addr, meta] of Object.entries(raw)) {
    if (String(meta?.symbol ?? "").toUpperCase() === "USDT") {
      return String(addr).trim();
    }
  }
  return DEFAULT_USDT_ETH;
}

/**
 * @param {import("@prisma/client").Chain} chain
 */
export async function listEvmUsdtSweepTargets(chain) {
  if (chain !== Chain.ETH) {
    throw new Error("UNSUPPORTED_EVM_SWEEP_CHAIN");
  }
  const network = EXPECTED_NETWORK_ETH;
  const token = pickUsdtTokenAddress(chain);

  const wallets = await prisma.wallet.findMany({
    where: {
      chain,
      currency: "USDT",
      network,
      ...ACTIVE,
    },
    orderBy: { createdAt: "asc" },
    include: {
      merchant: { select: { email: true, displayName: true } },
      assignedUser: { select: { externalUserId: true } },
    },
  });

  return {
    chain,
    network,
    configured: true,
    master_address: null,
    usdt_contract: token,
    wallets: wallets.map((w) => ({
      id: w.id,
      address: w.address,
      chain: w.chain,
      currency: w.currency,
      network: w.network,
      derivation_index: w.derivationIndex,
      environment: w.environment,
      external_user_id: w.assignedUser?.externalUserId ?? null,
      merchant_label: w.merchant.displayName ?? w.merchant.email,
    })),
  };
}

/**
 * @param {string | number} walletId
 * @param {import("@prisma/client").Chain} chain
 * @param {{ to_address?: string }} [opts] When `to_address` is set, send full USDT balance there. Otherwise send to the merchant’s USDT·ERC20 treasury from Gateway settings.
 */
export async function sweepEvmUsdtOne(walletId, chain, opts = {}) {
  if (chain !== Chain.ETH) {
    return { ok: false, error: "UNSUPPORTED_CHAIN" };
  }

  const wid = parseWalletDbId(walletId);
  if (wid == null) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  if (!re.rpcEth?.trim()) {
    return {
      ok: false,
      error: "RPC_ETH_NOT_SET",
      detail:
        "USDT·ERC20 sweep broadcasts via JSON-RPC; set RPC_ETH to any Ethereum node, or skip EVM consolidate until configured.",
    };
  }

  const toOverride =
    typeof opts.to_address === "string" ? opts.to_address.trim() : "";

  const tokenAddr = pickUsdtTokenAddress(chain);
  if (!tokenAddr) {
    return { ok: false, error: "NO_USDT_CONTRACT", detail: String(chain) };
  }

  const network = EXPECTED_NETWORK_ETH;

  const wallet = await prisma.wallet.findFirst({
    where: {
      id: wid,
      chain,
      currency: "USDT",
      network,
      ...ACTIVE,
    },
  });

  if (!wallet) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  /** @type {string} */
  let recipient;
  if (toOverride) {
    try {
      recipient = ethers.getAddress(toOverride);
    } catch {
      return {
        ok: false,
        error: "INVALID_TO_ADDRESS",
        detail: "to_address is not a valid Ethereum address",
      };
    }
  } else {
    const dest = await resolveMerchantRailSweepFromSettings(
      wallet.merchantId,
      USDT_ERC20_RAIL_KEY,
    );
    if (!dest.ok) {
      return {
        ok: false,
        error: dest.reason,
        detail: dest.message,
      };
    }
    recipient = ethers.getAddress(dest.master);
  }

  if (wallet.address.toLowerCase() === recipient.toLowerCase()) {
    return { ok: false, error: "SOURCE_IS_DESTINATION" };
  }

  const mnemonicPhrase = await getMerchantWalletMnemonic(wallet.merchantId);
  const path = `m/44'/60'/0'/0/${wallet.derivationIndex}`;
  const signer = HDNodeWallet.fromPhrase(mnemonicPhrase, undefined, path);
  if (signer.address.toLowerCase() !== wallet.address.toLowerCase()) {
    logger.error("evm usdt sweep: derived address mismatch", {
      walletId,
      chain,
      expected: wallet.address,
      derived: signer.address,
    });
    return { ok: false, error: "DERIVED_ADDRESS_MISMATCH" };
  }

  const staticNet = chainToStaticNetwork(chain);
  const provider = new JsonRpcProvider(chainToRpcUrl(chain), staticNet, {
    staticNetwork: true,
  });
  const budgetKey = evmRpcBudgetKey(chain);
  const connected = signer.connect(provider);

  await acquireOutboundRpcSlot(budgetKey);
  const usdt = new Contract(tokenAddr, ERC20_MIN_ABI, connected);
  const bal = await usdt.balanceOf(wallet.address);

  if (bal <= 0n) {
    return {
      ok: true,
      skipped: true,
      reason: "zero_usdt_balance",
      from_address: wallet.address,
      balance_atomic: bal.toString(),
    };
  }

  await acquireOutboundRpcSlot(budgetKey);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  if (gasPrice <= 0n) {
    return { ok: false, error: "NO_GAS_PRICE", detail: String(chain) };
  }

  await acquireOutboundRpcSlot(budgetKey);
  let gasLimit;
  try {
    gasLimit = await usdt.transfer.estimateGas(recipient, bal);
  } catch (e) {
    gasLimit = 120_000n;
    logger.warn("evm usdt sweep: estimateGas failed, using default", {
      chain,
      err: String(e),
    });
  }

  const gasBuffer = (gasLimit * gasPrice * 13n) / 10n;
  await acquireOutboundRpcSlot(budgetKey);
  const nativeBal = await provider.getBalance(wallet.address);
  if (nativeBal < gasBuffer) {
    return {
      ok: false,
      error: "INSUFFICIENT_NATIVE_FOR_GAS",
      detail: `Need ~${gasBuffer.toString()} wei on ${wallet.address}; have ${nativeBal.toString()}`,
    };
  }

  let tx;
  try {
    await acquireOutboundRpcSlot(budgetKey);
    tx = await usdt.transfer(recipient, bal);
    await acquireOutboundRpcSlot(budgetKey);
    const receipt = await tx.wait(1);
    if (!receipt?.status) {
      return { ok: false, error: "TX_REVERTED" };
    }
  } catch (e) {
    logger.error("evm usdt sweep transfer failed", {
      walletId,
      chain,
      err: String(e),
    });
    return { ok: false, error: "TRANSFER_FAILED", detail: String(e) };
  }

  logger.info("evm usdt swept", {
    walletId,
    chain,
    from: wallet.address,
    to: recipient,
    amount: bal.toString(),
    tx: tx.hash,
  });

  return {
    ok: true,
    tx_hash: tx.hash,
    amount_atomic: bal.toString(),
    from_address: wallet.address,
    to_address: recipient,
  };
}

/**
 * @param {import("@prisma/client").Chain} chain
 */
export async function sweepEvmUsdtAll(chain) {
  const list = await listEvmUsdtSweepTargets(chain);

  const results = [];
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const w of list.wallets) {
    const r = await sweepEvmUsdtOne(w.id, chain);
    if (r.ok) {
      if (r.skipped) {
        skipped += 1;
        results.push({
          wallet_id: w.id,
          status: "skipped",
          reason: r.reason,
          ...(r.from_address ? { from_address: r.from_address } : {}),
          ...(r.balance_atomic != null
            ? { balance_atomic: String(r.balance_atomic) }
            : {}),
          ...(r.detail ? { detail: r.detail } : {}),
        });
      } else {
        ok += 1;
        results.push({
          wallet_id: w.id,
          status: "swept",
          tx_hash: r.tx_hash,
          amount_atomic: r.amount_atomic,
        });
      }
    } else {
      failed += 1;
      results.push({
        wallet_id: w.id,
        status: "failed",
        error: r.error,
        detail: r.detail,
      });
    }
  }

  return {
    configured: true,
    chain,
    results,
    summary: {
      attempted: list.wallets.length,
      ok,
      skipped,
      failed,
    },
  };
}
