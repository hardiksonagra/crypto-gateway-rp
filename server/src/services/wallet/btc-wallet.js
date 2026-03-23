import * as bip39 from "bip39";
import BIP32Factory from "bip32";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";

const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

export function deriveBtcAddress(accountIndex, mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed);
  const child = root.derivePath(`m/44'/0'/0'/0/${accountIndex}`);
  if (!child.privateKey) throw new Error("Failed to derive BTC private key");
  const keyPair = ECPair.fromPrivateKey(child.privateKey);
  const { address } = bitcoin.payments.p2pkh({
    pubkey: keyPair.publicKey,
    network: bitcoin.networks.bitcoin,
  });
  if (!address) throw new Error("Failed to build BTC address");
  return address;
}
