import { Chain } from "@prisma/client";
import { SCANNED_EVM_CHAINS } from "crypto-payment-gateway/src/config/chains.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { loadAllLiveWalletsForChain } from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import { isChainLiveForPlatform } from "crypto-payment-gateway/src/lib/chain-enable.js";
import { scanBtcChain } from "./tracker/btc-tracker.js";
import { scanEvmChain } from "./tracker/evm-tracker.js";
import { scanTonChain } from "./tracker/ton-tracker.js";
import { scanTronChain } from "./tracker/tron-tracker.js";

/**
 * One maintenance pass: every live wallet on each enabled chain (same shape as worker scans).
 * Used by the interval cron, not the hot-path worker tick.
 */
export async function runFullDepositScanPass() {
  const counts = { evm: 0, tron: 0, ton: 0, btc: 0 };

  if (!re.depositScannerTronOnly) {
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

  if (!re.depositScannerTronOnly) {
    try {
      if (isChainLiveForPlatform(re.chainEnabledRecord, Chain.TON)) {
        const tonW = await loadAllLiveWalletsForChain(Chain.TON);
        counts.ton = tonW.length;
        await scanTonChain({ wallets: tonW });
      }
    } catch (e) {
      logger.error("deposit_full_scan_ton_failed", { err: String(e) });
    }
    try {
      if (isChainLiveForPlatform(re.chainEnabledRecord, Chain.BTC)) {
        const btcW = await loadAllLiveWalletsForChain(Chain.BTC);
        counts.btc = btcW.length;
        await scanBtcChain({ wallets: btcW });
      }
    } catch (e) {
      logger.error("deposit_full_scan_btc_failed", { err: String(e) });
    }
  }

  logger.info("deposit_full_scan_pass_done", {
    wallets_evm_total: counts.evm,
    wallets_tron: counts.tron,
    wallets_ton: counts.ton,
    wallets_btc: counts.btc,
    deposit_scanner_tron_only: re.depositScannerTronOnly,
  });
}
