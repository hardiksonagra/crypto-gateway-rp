import * as bip39 from "bip39";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";
import { utils } from "tronweb";

const bip32 = BIP32Factory(ecc);

/**
 * @param {number} bip44AddressIndex — BIP44 last segment `m/44'/195'/0'/0/{i}`
 * @param {string} mnemonic
 * @returns {string} 64-char hex private key (no 0x)
 */
export function deriveTronPrivateKeyHex(bip44AddressIndex, mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed);
  const child = root.derivePath(`m/44'/195'/0'/0/${bip44AddressIndex}`);
  if (!child.privateKey) throw new Error("Failed to derive TRON private key");
  return Buffer.from(child.privateKey).toString("hex");
}

export function deriveTronAddress(accountIndex, mnemonic) {
  const pkHex = deriveTronPrivateKeyHex(accountIndex, mnemonic);
  const addr = utils.address.fromPrivateKey(pkHex);
  if (!addr) throw new Error("Invalid TRON key derivation");
  return addr;
}
