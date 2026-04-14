import { Chain } from "@prisma/client";
import { SCANNED_EVM_CHAINS } from "crypto-payment-gateway/src/config/chains.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { loadAllLiveWalletsForChain } from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import { isChainLiveForPlatform } from "crypto-payment-gateway/src/lib/chain-enable.js";
import { scanEvmChain } from "./tracker/evm-tracker.js";
import { scanTronChain } from "./tracker/tron-tracker.js";

/**
 * One maintenance pass: every live wallet on TRON + Ethereum (ERC20), same shape as worker scans.
 */
export async function runFullDepositScanPass() {
  const counts = { evm: 0, tron: 0 };

  for (const chain of SCANNED_EVM_CHAINS) {
    if (!isChainLiveForPlatform(re.chainEnabledRecord, chain)) continue;
    const wallets = await loadAllLiveWalletsForChain(chain);
    counts.evm += wallets.length;
    try {
      await scanEvmChain(chain, { wallets });
    } catch (e) {
      logger.error("deposit_full_scan_evm_failed", {
        chain,
        err: String(e),
      });
    }
  }

  try {
    if (isChainLiveForPlatform(re.chainEnabledRecord, Chain.TRON)) {
      const tronW = await loadAllLiveWalletsForChain(Chain.TRON);
      counts.tron = tronW.length;
      await scanTronChain({ wallets: tronW });
    }
  } catch (e) {
    logger.error("deposit_full_scan_tron_failed", { err: String(e) });
  }

  logger.info("deposit_full_scan_pass_done", {
    wallets_evm_total: counts.evm,
    wallets_tron: counts.tron,
    deposit_scanner_tron_only: re.depositScannerTronOnly,
  });
}
