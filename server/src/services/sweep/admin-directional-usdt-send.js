import { Chain } from "@prisma/client";
import { ethers } from "ethers";
import { utils as tronUtils } from "tronweb";
import { prisma } from "../../lib/prisma.js";
import { sweepEvmUsdtOne } from "./evm-usdt-sweep.js";
import { sweepTronUsdtOne } from "./tron-usdt-sweep.js";

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
 * Resolves `from_address` to a gateway-managed USDT deposit wallet and sends **full on-chain USDT balance**
 * to `to_address` (same rail: TRC20 or ERC20). Does not perform DEX swaps — on-chain USDT `transfer` only.
 *
 * @param {{ from_address: string, to_address: string }} p
 * @returns {Promise<object>}
 */
export async function adminDirectionalUsdtSend(p) {
  const from = String(p.from_address ?? "").trim();
  const to = String(p.to_address ?? "").trim();
  if (!from || !to) {
    return {
      ok: false,
      error: "validation",
      message: "from_address and to_address are required",
    };
  }

  const ethWallet = await prisma.wallet.findFirst({
    where: {
      chain: Chain.ETH,
      currency: "USDT",
      network: "ERC20",
      address: { equals: from, mode: "insensitive" },
    },
    select: { id: true, address: true },
  });

  const tronCandidates = await prisma.wallet.findMany({
    where: {
      chain: Chain.TRON,
      currency: "USDT",
      network: "TRC20",
    },
    select: { id: true, address: true },
  });
  const tronWallet =
    tronCandidates.find((w) => tronAddrEq(w.address, from)) ?? null;

  if (ethWallet) {
    let toNorm;
    try {
      toNorm = ethers.getAddress(to);
    } catch {
      return {
        ok: false,
        error: "INVALID_TO_ADDRESS",
        message: "to_address is not a valid Ethereum address",
      };
    }
    if (ethWallet.address.toLowerCase() === toNorm.toLowerCase()) {
      return {
        ok: false,
        error: "SOURCE_IS_DESTINATION",
        message: "from and to must differ",
      };
    }
    const r = await sweepEvmUsdtOne(ethWallet.id, Chain.ETH, {
      to_address: toNorm,
    });
    return {
      ...r,
      rail: "USDT·ERC20",
      chain: "ETH",
      wallet_id: ethWallet.id,
    };
  }

  if (tronWallet) {
    try {
      tronUtils.address.toHex(to);
    } catch {
      return {
        ok: false,
        error: "INVALID_TO_ADDRESS",
        message: "to_address is not a valid TRON address",
      };
    }
    if (tronAddrEq(tronWallet.address, to)) {
      return {
        ok: false,
        error: "SOURCE_IS_DESTINATION",
        message: "from and to must differ",
      };
    }
    const r = await sweepTronUsdtOne(tronWallet.id, { to_address: to });
    return {
      ...r,
      rail: "USDT·TRC20",
      chain: "TRON",
      wallet_id: tronWallet.id,
    };
  }

  return {
    ok: false,
    error: "FROM_WALLET_NOT_FOUND",
    message:
      "No gateway USDT deposit wallet (TRC20 or ERC20) matches from_address.",
  };
}
