import { Chain } from "@prisma/client";

/** Human-readable native asset tickers per logical chain (for ERC20/native reconciliation). */
export function nativeSymbolForChain(chain: Chain): string {
  switch (chain) {
    case Chain.ETH:
    case Chain.ARBITRUM:
    case Chain.OPTIMISM:
      return "ETH";
    case Chain.BNB:
      return "BNB";
    case Chain.POLYGON:
      return "MATIC";
    case Chain.TRON:
      return "TRX";
    case Chain.TON:
      return "TON";
    case Chain.BTC:
      return "BTC";
    default:
      return "NATIVE";
  }
}

export function nativeDecimalsForChain(chain: Chain): number {
  if (chain === Chain.TRON) return 6;
  if (chain === Chain.TON) return 9;
  if (chain === Chain.BTC) return 8;
  return 18;
}
