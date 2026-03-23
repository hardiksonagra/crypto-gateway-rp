import { ethers } from "ethers";
import { env } from "../../config/env.js";

export function deriveEvmAddress(accountIndex) {
  const path = `m/44'/60'/0'/0/${accountIndex}`;
  const wallet = ethers.HDNodeWallet.fromPhrase(env.mnemonic, undefined, path);
  return ethers.getAddress(wallet.address);
}
