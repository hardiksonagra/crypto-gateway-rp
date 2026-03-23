import { Chain } from "@prisma/client";
import { Network } from "ethers";
import { env } from "./env.js";

/**
 * Chain metadata: maps logical Chain enum to RPC / network identifiers.
 * EVM chains share ethers.js logic; each has its own provider URL and optional chainId check.
 */
export const EVM_CHAINS: readonly Chain[] = [
  Chain.ETH,
  Chain.BNB,
  Chain.POLYGON,
  Chain.ARBITRUM,
  Chain.OPTIMISM,
] as const;

export function isEvmChain(chain: Chain): boolean {
  return (EVM_CHAINS as readonly string[]).includes(chain);
}

/** Fixed chain IDs avoid ethers "detect network" polling on every new JsonRpcProvider. */
export function chainToStaticNetwork(chain: Chain): Network {
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

export function chainToRpcUrl(chain: Chain): string {
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

export function confirmationsForChain(chain: Chain): number {
  if (isEvmChain(chain)) return env.confirmationsEvm;
  if (chain === Chain.TRON) return env.confirmationsTron;
  if (chain === Chain.BTC) return env.confirmationsBtc;
  if (chain === Chain.TON) return env.confirmationsTon;
  return env.confirmationsEvm;
}
