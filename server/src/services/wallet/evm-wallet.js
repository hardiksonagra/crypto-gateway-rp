import { ethers } from "ethers";

/**
 * @param {number} accountIndex
 * @param {string} mnemonicPhrase — BIP39 phrase for this merchant’s HD root.
 */
export function deriveEvmAddress(accountIndex, mnemonicPhrase) {
  const phrase = String(mnemonicPhrase ?? "").trim();
  if (!phrase) {
    throw new Error("MNEMONIC_REQUIRED");
  }
  const path = `m/44'/60'/0'/0/${accountIndex}`;
  const wallet = ethers.HDNodeWallet.fromPhrase(phrase, undefined, path);
  return ethers.getAddress(wallet.address);
}
