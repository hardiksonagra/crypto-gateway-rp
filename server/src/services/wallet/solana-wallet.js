import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";

/**
 * Phantom / Solflare-style path: `m/44'/501'/{account}'/0'`.
 *
 * @param {number} bip44AddressIndex — same index family as TRON/EVM deposit wallets (`derivation_index`)
 * @param {string} mnemonic
 * @returns {import("@solana/web3.js").Keypair}
 */
export function deriveSolanaKeypair(bip44AddressIndex, mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic, "");
  const path = `m/44'/501'/${bip44AddressIndex}'/0'`;
  const { key } = derivePath(path, seed.toString("hex"));
  return Keypair.fromSeed(key.slice(0, 32));
}

/**
 * @param {number} bip44AddressIndex
 * @param {string} mnemonic
 * @returns {string}
 */
export function deriveSolanaAddressBase58(bip44AddressIndex, mnemonic) {
  return deriveSolanaKeypair(bip44AddressIndex, mnemonic).publicKey.toBase58();
}
