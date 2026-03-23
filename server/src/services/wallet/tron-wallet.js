import * as bip39 from "bip39";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";
import { utils } from "tronweb";

const bip32 = BIP32Factory(ecc);

export function deriveTronAddress(accountIndex, mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed);
  const child = root.derivePath(`m/44'/195'/0'/0/${accountIndex}`);
  if (!child.privateKey) throw new Error("Failed to derive TRON private key");
  const pkHex = Buffer.from(child.privateKey).toString("hex");
  const addr = utils.address.fromPrivateKey(pkHex);
  if (!addr) throw new Error("Invalid TRON key derivation");
  return addr;
}
