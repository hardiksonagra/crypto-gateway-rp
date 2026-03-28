import { Chain } from "@prisma/client";

export function nativeSymbolForChain(chain) {
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
    case Chain.SOLANA:
      return "SOL";
    default:
      return "NATIVE";
  }
}

export function nativeDecimalsForChain(chain) {
  if (chain === Chain.TRON) return 6;
  if (chain === Chain.TON) return 9;
  if (chain === Chain.BTC) return 8;
  if (chain === Chain.SOLANA) return 9;
  return 18;
}
