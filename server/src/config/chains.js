import { Chain } from "@prisma/client";
import { Network } from "ethers";
import { env } from "./env.js";

export const EVM_CHAINS = [
  Chain.ETH,
  Chain.BNB,
  Chain.POLYGON,
  Chain.ARBITRUM,
  Chain.OPTIMISM,
];

/** Worker only scans these EVM chains (gateway USDT ERC20 / BEP20). */
export const SCANNED_EVM_CHAINS = [Chain.ETH, Chain.BNB];

export function isEvmChain(chain) {
  return EVM_CHAINS.includes(chain);
}

export function chainToStaticNetwork(chain) {
  switch (chain) {
    case Chain.ETH:
      return Network.from(1);
    case Chain.BNB:
      return Network.from(56);
    case Chain.POLYGON:
      return Network.from(137);
    case Chain.ARBITRUM:
      return Network.from(42161);
    case Chain.OPTIMISM:
      return Network.from(10);
    default:
      throw new Error(`Not an EVM chain: ${chain}`);
  }
}

export function chainToRpcUrl(chain) {
  switch (chain) {
    case Chain.ETH:
      return env.rpcEth;
    case Chain.BNB:
      return env.rpcBnb;
    case Chain.POLYGON:
      return env.rpcPolygon;
    case Chain.ARBITRUM:
      return env.rpcArbitrum;
    case Chain.OPTIMISM:
      return env.rpcOptimism;
    default:
      throw new Error(`Not an EVM chain: ${chain}`);
  }
}

export function confirmationsForChain(chain) {
  if (isEvmChain(chain)) return env.confirmationsEvm;
  if (chain === Chain.TRON) return env.confirmationsTron;
  if (chain === Chain.BTC) return env.confirmationsBtc;
  if (chain === Chain.TON) return env.confirmationsTon;
  return env.confirmationsEvm;
}
