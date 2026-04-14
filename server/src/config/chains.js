import { Chain } from "@prisma/client";
import { Network } from "ethers";
import { re } from "./runtime-env.js";

/** Product EVM surface: Ethereum (USDT·ERC20) only. */
export const EVM_CHAINS = [Chain.ETH];

/** Worker only scans Ethereum for USDT ERC20 deposits. */
export const SCANNED_EVM_CHAINS = [Chain.ETH];

export function isEvmChain(chain) {
  return EVM_CHAINS.includes(chain);
}

export function chainToStaticNetwork(chain) {
  switch (chain) {
    case Chain.ETH:
      return Network.from(1);
    default:
      throw new Error(`Not an EVM chain: ${chain}`);
  }
}

export function chainToRpcUrl(chain) {
  switch (chain) {
    case Chain.ETH:
      return re.rpcEth;
    default:
      throw new Error(`Not an EVM chain: ${chain}`);
  }
}

export function confirmationsForChain(chain) {
  if (isEvmChain(chain)) return re.confirmationsEvm;
  if (chain === Chain.TRON) return re.confirmationsTron;
  return re.confirmationsEvm;
}
