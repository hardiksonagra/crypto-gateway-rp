import { ethers } from "ethers";
import { env } from "../../config/env.js";

/**
 * EVM HD derivation (BIP44 coin type 60).
 * One mnemonic + index produces the same address on every EVM chain (ETH, BNB, Polygon, etc.).
 */
export function deriveEvmAddress(accountIndex: number): string {
  const path = `m/44'/60'/0'/0/${accountIndex}`;
  const wallet = ethers.HDNodeWallet.fromPhrase(env.mnemonic, undefined, path);
  return ethers.getAddress(wallet.address);
}
