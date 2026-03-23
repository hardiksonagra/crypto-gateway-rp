import { mnemonicToHDSeed, deriveEd25519Path, keyPairFromSeed } from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";

export async function deriveTonAddress(accountIndex, mnemonic) {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length < 12) throw new Error("Invalid mnemonic");
  const hdSeed = await mnemonicToHDSeed(words);
  const secretKey = await deriveEd25519Path(hdSeed, [44, 607, 0, 0, accountIndex]);
  const kp = keyPairFromSeed(secretKey);
  const w = WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey });
  return w.address.toString({ bounceable: false, urlSafe: true });
}
