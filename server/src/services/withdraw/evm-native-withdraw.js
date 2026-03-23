import { HDNodeWallet, JsonRpcProvider } from "ethers";
import { env } from "../../config/env.js";
import { chainToRpcUrl, chainToStaticNetwork, isEvmChain } from "../../config/chains.js";
import { prisma } from "../../lib/prisma.js";

const GAS_LIMIT_NATIVE = 21_000n;

export async function sendEvmNativeFromMerchantPool(params) {
  const { merchantId, chain, toAddress, amountWei } = params;
  if (!isEvmChain(chain)) throw new Error("NOT_EVM_CHAIN");

  const provider = new JsonRpcProvider(chainToRpcUrl(chain), chainToStaticNetwork(chain), {
    staticNetwork: true,
  });

  const wallets = await prisma.wallet.findMany({
    where: { chain, user: { merchantId } },
    include: { user: { select: { accountIndex: true } } },
    orderBy: { createdAt: "asc" },
  });

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  const gasReserve = gasPrice * GAS_LIMIT_NATIVE;

  for (const w of wallets) {
    const path = `m/44'/60'/0'/0/${w.user.accountIndex}`;
    const signer = HDNodeWallet.fromPhrase(env.mnemonic, undefined, path).connect(provider);
    if (signer.address.toLowerCase() !== w.address.toLowerCase()) {
      continue;
    }
    const bal = await provider.getBalance(signer.address);
    if (bal < amountWei + gasReserve) continue;

    const tx = await signer.sendTransaction({
      to: toAddress,
      value: amountWei,
      gasLimit: GAS_LIMIT_NATIVE,
      ...(gasPrice > 0n ? { gasPrice } : {}),
    });
    const receipt = await tx.wait(1);
    if (!receipt?.status) throw new Error("TX_REVERTED");
    return { txHash: tx.hash, fromAddress: signer.address };
  }

  throw new Error("NO_FUNDED_WALLET_FOR_WITHDRAW");
}
